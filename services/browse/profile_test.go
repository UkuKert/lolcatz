package main

import (
	"database/sql"
	"encoding/json"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

// Run against the Compose database. Temporary tables isolate all fixture data.
func TestPublicProfile(t *testing.T) {
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
 CREATE TEMP TABLE users (id bigint PRIMARY KEY, name text, email text, subject text);
 CREATE TEMP TABLE comments (id bigserial PRIMARY KEY, image_id text, body text);
 CREATE TEMP TABLE images (LIKE public.images INCLUDING ALL);
 CREATE TEMP TABLE image_annotations (LIKE public.image_annotations INCLUDING ALL);
 CREATE TEMP TABLE image_exif (LIKE public.image_exif INCLUDING ALL);
 CREATE TEMP TABLE image_ocr (LIKE public.image_ocr INCLUDING ALL);
 INSERT INTO users VALUES (901, 'Alice', 'private@example.test', 'private-subject'), (902, 'Bob', 'bob@example.test', 'bob-subject');
 INSERT INTO images (id, board, title, filename, content_type, size, author, user_id)
 VALUES ('profile-test-alice', 'b', 'Alice photo', 'alice.png', 'image/png', 1, 'private@example.test', 901),
 ('profile-test-bob', 'b', 'Bob photo', 'bob.png', 'image/png', 1, 'bob@example.test', 902);
 INSERT INTO comments(image_id, body) VALUES ('profile-test-alice', 'One'), ('profile-test-alice', 'Two');
 INSERT INTO image_annotations (id, image_id, label, confidence, x1,y1,x2,y2,producer_version)
 VALUES (901, 'profile-test-alice', 'cat', .9, .1,.1,.5,.5,'test'),
 (902, 'profile-test-alice', 'cat', .8, .5,.5,.9,.9,'test');`)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("GET", "/api/browse/users/901", nil)
	request.SetPathValue("id", "901")
	response := httptest.NewRecorder()
	handleUser(response, request)
	if response.Code != 200 {
		t.Fatalf("status %d: %s", response.Code, response.Body)
	}
	var result struct {
		User struct {
			ID   int64
			Name string
		}
		Images []Image
	}
	if err := json.Unmarshal(response.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	if result.User.Name != "Alice" || len(result.Images) != 1 || result.Images[0].ID != "profile-test-alice" {
		t.Fatalf("wrong profile: %+v", result)
	}
	if result.Images[0].CommentCount != 2 {
		t.Fatalf("want 2 comments regardless of annotation count, got %d", result.Images[0].CommentCount)
	}
	if len(result.Images[0].Tags) != 1 || len(result.Images[0].Annotations) != 2 {
		t.Fatal("tags must deduplicate labels while preserving both boxes")
	}
	if strings.Contains(response.Body.String(), "private") || strings.Contains(response.Body.String(), "email") || strings.Contains(response.Body.String(), "subject") {
		t.Fatal("public profile leaked private account fields")
	}
	for _, id := range []string{"invalid", "-1", "999999"} {
		request.SetPathValue("id", id)
		response = httptest.NewRecorder()
		handleUser(response, request)
		if response.Code != 404 {
			t.Fatalf("id %s: got %d", id, response.Code)
		}
	}
}
