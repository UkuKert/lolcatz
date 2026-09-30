use std::time::Instant;

use chrono::{DateTime, Utc};
use rocket::{
    fairing::{Fairing, Info, Kind},
    http::Status,
    response::status::Custom,
    serde::json::Json,
    Build, Data, Request, Response, Rocket, State,
};
use rocket_prometheus::{
    prometheus::{HistogramOpts, HistogramVec, IntCounterVec, IntGauge, Opts},
    PrometheusMetrics,
};
use serde::{Deserialize, Serialize};
use sqlx::{types::Json as SqlJson, FromRow, PgPool};

pub const ROUTE: &str = "GET /api/search/search";

#[derive(Clone)]
pub struct Metrics {
    pub prometheus: PrometheusMetrics,
    pub query_duration: HistogramVec,
    requests: IntCounterVec,
    inflight: IntGauge,
}

impl Metrics {
    pub fn new() -> Result<Self, rocket_prometheus::prometheus::Error> {
        let prometheus = PrometheusMetrics::new();
        let query_duration = HistogramVec::new(HistogramOpts::new(
            "lolcatz_search_query_duration_seconds",
            "Search latency including pool wait, SQL execution and row decoding, excluding HTTP serialization.",
        ).buckets(vec![0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.0, 5.0, 10.0, 30.0]), &["query_type", "outcome"])?;
        let requests = IntCounterVec::new(
            Opts::new(
                "lolcatz_http_requests_total",
                "Completed application requests.",
            ),
            &["route", "method", "code"],
        )?;
        let inflight = IntGauge::new(
            "lolcatz_http_requests_in_flight",
            "Concurrent application requests.",
        )?;
        prometheus
            .registry()
            .register(Box::new(query_duration.clone()))?;
        prometheus.registry().register(Box::new(requests.clone()))?;
        prometheus.registry().register(Box::new(inflight.clone()))?;
        for kind in ["text", "board_text", "tag"] {
            for outcome in ["success", "error"] {
                query_duration.with_label_values(&[kind, outcome]);
            }
        }
        Ok(Self {
            prometheus,
            query_duration,
            requests,
            inflight,
        })
    }
}

#[rocket::async_trait]
impl Fairing for Metrics {
    fn info(&self) -> Info {
        Info {
            name: "Application HTTP metrics",
            kind: Kind::Request | Kind::Response,
        }
    }

    async fn on_request(&self, _: &mut Request<'_>, _: &mut Data<'_>) {
        self.inflight.inc();
    }

    async fn on_response<'r>(&self, request: &'r Request<'_>, response: &mut Response<'r>) {
        self.inflight.dec();
        let route = if request.route().is_some() {
            ROUTE
        } else {
            "unmatched"
        };
        self.requests
            .with_label_values(&[
                route,
                request.method().as_str(),
                &response.status().code.to_string(),
            ])
            .inc();
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Tag {
    pub name: String,
    pub confidence: f64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Annotation {
    pub id: i64,
    pub label: String,
    pub confidence: f64,
    pub bbox: [f64; 4],
}

#[derive(Debug, Serialize, Deserialize, FromRow)]
pub struct Image {
    pub id: String,
    pub board: String,
    pub title: String,
    pub filename: String,
    pub content_type: String,
    pub tags: SqlJson<Vec<Tag>>,
    pub annotations: SqlJson<Vec<Annotation>>,
    pub uploaded_at: DateTime<Utc>,
    pub comment_count: i64,
    #[sqlx(skip)]
    pub image_url: String,
}

pub struct SearchState {
    pub pool: PgPool,
    pub metrics: Metrics,
}

#[rocket::get("/api/search/search?<q>&<tag>&<board>")]
async fn search(
    q: Option<&str>,
    tag: Option<&str>,
    board: Option<&str>,
    state: &State<SearchState>,
) -> Result<Json<Vec<Image>>, Custom<&'static str>> {
    let q = q.unwrap_or_default().trim();
    let tag = tag.unwrap_or_default().trim();
    let board = board.unwrap_or_default().trim();
    let (kind, predicate, args) = if !tag.is_empty() {
        (
            "tag",
            "EXISTS (SELECT 1 FROM image_annotations f WHERE f.image_id = i.id AND f.label = $1)",
            vec![tag],
        )
    } else if !q.is_empty() && !board.is_empty() {
        (
            "board_text",
            "i.board = $1 AND (i.title ILIKE '%' || $2 || '%' OR o.text ILIKE '%' || $2 || '%')",
            vec![board, q],
        )
    } else if !q.is_empty() {
        (
            "text",
            "i.title ILIKE '%' || $1 || '%' OR o.text ILIKE '%' || $1 || '%'",
            vec![q],
        )
    } else {
        return Err(Custom(Status::BadRequest, "provide q or tag\n"));
    };
    let sql = format!(
        "{} WHERE {} GROUP BY i.id, o.derived_title ORDER BY i.uploaded_at DESC LIMIT 50",
        include_str!("search.sql"),
        predicate
    );
    let mut query = sqlx::query_as::<_, Image>(&sql);
    for value in args {
        query = query.bind(value);
    }
    let start = Instant::now();
    // fetch_all returns an error if ANY row fails to decode, never partial success.
    let result = query.fetch_all(&state.pool).await;
    state
        .metrics
        .query_duration
        .with_label_values(&[kind, if result.is_ok() { "success" } else { "error" }])
        .observe(start.elapsed().as_secs_f64());
    let mut images = result.map_err(|err| {
        eprintln!("search database error: {err}");
        Custom(Status::InternalServerError, "db error\n")
    })?;
    for image in &mut images {
        image.image_url = format!("/api/browse/media/{}", image.id);
    }
    Ok(Json(images))
}

pub fn application(config: rocket::Config, pool: PgPool, metrics: Metrics) -> Rocket<Build> {
    rocket::custom(config)
        .attach(metrics.prometheus.clone())
        .attach(metrics.clone())
        .manage(SearchState { pool, metrics })
        .mount("/", rocket::routes![search])
}

#[rocket::get("/health")]
fn health() -> Status {
    Status::Ok
}

pub fn monitoring(config: rocket::Config, metrics: &Metrics) -> Rocket<Build> {
    rocket::custom(config)
        .mount("/", rocket::routes![health])
        .mount("/metrics", metrics.prometheus.clone())
}
