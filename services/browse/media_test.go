package main

import (
	"context"
	"net/url"
	"testing"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

func TestMediaSignatureAllowsLongLivedBrowserCaching(t *testing.T) {
	for _, secure := range []bool{false, true} {
		t.Run(map[bool]string{false: "http", true: "https"}[secure], func(t *testing.T) {
			previousClient, previousBucket := minioClient, bucket
			t.Cleanup(func() { minioClient, bucket = previousClient, previousBucket })
			var err error
			minioClient, err = minio.New("minio.example.test", &minio.Options{
				Creds:  credentials.NewStaticV4("test", "test", ""),
				Secure: secure,
				Region: "test-region",
			})
			if err != nil {
				t.Fatal(err)
			}
			bucket = "images"
			for _, filename := range []string{"", "photo.jpg"} {
				u, err := url.Parse(presign(context.Background(), "b", "image-id", filename))
				if err != nil {
					t.Fatal(err)
				}
				if u.Scheme != map[bool]string{false: "http", true: "https"}[secure] || u.Host != "minio.example.test" || u.Path != "/images/b/image-id" {
					t.Fatalf("wrong public target: %s", u)
				}
				query := u.Query()
				if query.Get("X-Amz-Expires") != "604800" || query.Get("response-cache-control") != "public, max-age=31536000, immutable" {
					t.Fatal("signature lifetime or object caching is incorrect")
				}
				if filename != "" && query.Get("response-content-disposition") != "attachment; filename=photo.jpg" {
					t.Fatal("download filename was lost")
				}
			}
		})
	}
}
