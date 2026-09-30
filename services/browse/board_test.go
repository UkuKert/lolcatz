package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"time"
)

func TestBoardRejectsInvalidCursor(t *testing.T) {
	for _, query := range []string{"before=invalid&before_id=a", "before_id=a", "before=2026-09-26T12:00:00Z"} {
		request := httptest.NewRequest("GET", "/api/browse/boards/b?"+query, nil)
		request.SetPathValue("board", "b")
		response := httptest.NewRecorder()
		handleBoard(response, request)
		if response.Code != 400 {
			t.Fatalf("%s: status %d", query, response.Code)
		}
	}
}

// Temporary tables isolate this test from the Compose application's data.
func TestBoardCursorPagination(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	connection, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer connection.Close()
	connection.SetMaxOpenConns(1)
	previous := db
	db = connection
	defer func() { db = previous }()
	_, err = db.Exec(`
 CREATE TEMP TABLE users (id bigint PRIMARY KEY, name text);
 CREATE TEMP TABLE comments (id bigserial PRIMARY KEY, image_id text);
 CREATE TEMP TABLE images (LIKE public.images INCLUDING ALL);
 CREATE TEMP TABLE image_annotations (LIKE public.image_annotations INCLUDING ALL);
 CREATE TEMP TABLE image_exif (LIKE public.image_exif INCLUDING ALL);
 CREATE TEMP TABLE image_ocr (LIKE public.image_ocr INCLUDING ALL);
 INSERT INTO images (id, board, title, filename, content_type, size, author, uploaded_at)
 SELECT 'wall-' || lpad(n::text, 3, '0'), 'b', 'Wall image', 'wall.jpg', 'image/jpeg', 1, 'Test',
        '2026-09-26 12:00:00.123456+00'::timestamptz + (n / 50) * interval '1 second'
 FROM generate_series(1, 427) n;
 INSERT INTO images (id, board, title, filename, content_type, size, author)
 VALUES ('other-board', 'cats', 'Other board', 'cat.jpg', 'image/jpeg', 1, 'Test');`)
	if err != nil {
		t.Fatal(err)
	}
	query := ""
	var ids []string
	for {
		request := httptest.NewRequest("GET", "/api/browse/boards/b"+query, nil)
		request.SetPathValue("board", "b")
		response := httptest.NewRecorder()
		handleBoard(response, request)
		if response.Code != 200 {
			t.Fatalf("status %d: %s", response.Code, response.Body)
		}
		var page []Image
		if err := json.Unmarshal(response.Body.Bytes(), &page); err != nil {
			t.Fatal(err)
		}
		for _, image := range page {
			ids = append(ids, image.ID)
		}
		if len(ids) == 25 {
			// New uploads and deletion of the cursor row must not shift later pages.
			_, err = db.Exec(`DELETE FROM images WHERE id = $1`, page[len(page)-1].ID)
			if err != nil {
				t.Fatal(err)
			}
			_, err = db.Exec(`INSERT INTO images (id, board, title, filename, content_type, size, author, uploaded_at)
 VALUES ('new-upload', 'b', 'New', 'new.jpg', 'image/jpeg', 1, 'Test', '2026-09-27T00:00:00Z')`)
			if err != nil {
				t.Fatal(err)
			}
		}
		if len(page) < 25 {
			break
		}
		last := page[len(page)-1]
		query = "?" + url.Values{"before": {last.UploadedAt.Format(time.RFC3339Nano)}, "before_id": {last.ID}}.Encode()
		if len(ids) > 427 {
			t.Fatal("pagination repeated images")
		}
	}
	if len(ids) != 427 {
		t.Fatalf("got %d images, want 427", len(ids))
	}
	for i, id := range ids {
		if want := fmt.Sprintf("wall-%03d", 427-i); id != want {
			t.Fatalf("image %d: got %s, want %s", i, id, want)
		}
	}
}
