package main

import (
	"database/sql/driver"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
)

func imageRow() []driver.Value {
	return []driver.Value{"image", "b", "title", "image.jpg", "image/jpeg", int64(1), "author", nil,
		"[]", "[]", time.Now(), int64(0), nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil}
}

func resultRows(values []driver.Value) *sqlmock.Rows {
	columns := make([]string, len(values))
	for i := range columns {
		columns[i] = fmt.Sprint(i)
	}
	return sqlmock.NewRows(columns).AddRow(values...)
}

func TestHandlersRejectPartialDatabaseResults(t *testing.T) {
	for _, endpoint := range []string{"board", "profile", "nearby", "counts", "comments"} {
		for _, failure := range []string{"scan", "iteration"} {
			t.Run(endpoint+"/"+failure, func(t *testing.T) {
				connection, mock, err := sqlmock.New()
				if err != nil {
					t.Fatal(err)
				}
				previous := db
				db = connection
				t.Cleanup(func() { db = previous; connection.Close() })
				request := httptest.NewRequest("GET", "/?lat=1&lon=2&radius=100", nil)
				request.SetPathValue("board", "b")
				request.SetPathValue("id", "1")
				var handler http.HandlerFunc
				values := imageRow()
				switch endpoint {
				case "board":
					handler = handleBoard
				case "profile":
					handler = handleUser
					mock.ExpectQuery("SELECT id, name FROM users").WillReturnRows(sqlmock.NewRows([]string{"id", "name"}).AddRow(1, "user"))
				case "nearby":
					handler = handleNearby
					values = []driver.Value{"image", float64(1)}
				case "counts":
					handler = handleBoardCounts
					values = []driver.Value{"b", int64(1)}
				case "comments":
					handler = handleImage
					mock.ExpectQuery("SELECT").WillReturnRows(resultRows(imageRow()))
					values = []driver.Value{int64(1), "comment", "author", nil, time.Now()}
				}
				rows := resultRows(values)
				bad := append([]driver.Value(nil), values...)
				if failure == "scan" {
					bad[0] = nil
				}
				rows.AddRow(bad...)
				if failure == "iteration" {
					rows.RowError(1, errors.New("connection interrupted"))
				}
				mock.ExpectQuery("SELECT").WillReturnRows(rows).RowsWillBeClosed()
				response := httptest.NewRecorder()
				handler(response, request)
				if response.Code != http.StatusInternalServerError || response.Body.String() != "db error\n" {
					t.Fatalf("returned partial success: %d %s", response.Code, response.Body.String())
				}
				if err := mock.ExpectationsWereMet(); err != nil {
					t.Fatal(err)
				}
			})
		}
	}
}
