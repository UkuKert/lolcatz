package main

import (
	"database/sql/driver"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestOwnImagesRejectPartialDatabaseResults(t *testing.T) {
	for _, failure := range []string{"scan", "iteration"} {
		t.Run(failure, func(t *testing.T) {
			connection, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			previous := db
			db = connection
			t.Cleanup(func() { db = previous; connection.Close() })
			values := []driver.Value{"image", "b", "title", "image.jpg", "image/jpeg", "[]", "[]", time.Now(), int64(0)}
			rows := sqlmock.NewRows([]string{"id", "board", "title", "filename", "type", "tags", "annotations", "uploaded", "comments"}).AddRow(values...)
			switch failure {
			case "scan":
				values[0] = nil
			}
			rows.AddRow(values...)
			if failure == "iteration" {
				rows.RowError(1, errors.New("connection interrupted"))
			}
			mock.ExpectQuery("SELECT").WillReturnRows(rows).RowsWillBeClosed()
			response := httptest.NewRecorder()
			handleMyImages(response, httptest.NewRequest("GET", "/api/upload/images", nil))
			if response.Code != http.StatusInternalServerError || response.Body.String() != "db error\n" {
				t.Fatalf("returned partial success: %d %s", response.Code, response.Body.String())
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}
