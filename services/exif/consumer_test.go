package main

import (
	"context"
	"errors"
	"io"
	"testing"
	"time"

	"github.com/segmentio/kafka-go"
)

type fakeReader struct {
	messages  []kafka.Message
	fetched   int
	committed []kafka.Message
	commitErr error
}

func (r *fakeReader) FetchMessage(context.Context) (kafka.Message, error) {
	if r.fetched == len(r.messages) {
		return kafka.Message{}, io.EOF
	}
	m := r.messages[r.fetched]
	r.fetched++
	return m, nil
}

func (r *fakeReader) CommitMessages(_ context.Context, messages ...kafka.Message) error {
	if r.commitErr != nil {
		return r.commitErr
	}
	r.committed = append(r.committed, messages...)
	return nil
}

func TestConsumerRetriesBeforeCommitting(t *testing.T) {
	r := &fakeReader{messages: []kafka.Message{{Value: []byte(`{"id":"image","content_type":"image/jpeg"}`), Offset: 7}}}
	attempts := 0
	err := consume(context.Background(), r, func(_ context.Context, event ImageEvent) error {
		attempts++
		if event.ID != "image" || len(r.committed) != 0 {
			t.Fatal("wrong event or committed before success")
		}
		if attempts < 3 {
			return errors.New("storage unavailable")
		}
		return nil
	}, 0)
	if !errors.Is(err, io.EOF) || attempts != 3 || len(r.committed) != 1 || r.committed[0].Offset != 7 {
		t.Fatalf("err=%v attempts=%d commits=%v", err, attempts, r.committed)
	}
}

func TestConsumerStopsBeforeLaterOffsetsOnFailure(t *testing.T) {
	failure := errors.New("database unavailable")
	r := &fakeReader{messages: []kafka.Message{{Value: []byte(`{"id":"first","content_type":"image/jpeg"}`)}, {Value: []byte(`{"id":"second","content_type":"image/jpeg"}`)}}}
	attempts := 0
	err := consume(context.Background(), r, func(context.Context, ImageEvent) error {
		attempts++
		return failure
	}, 0)
	if !errors.Is(err, failure) || attempts != 3 || r.fetched != 1 || len(r.committed) != 0 {
		t.Fatalf("err=%v attempts=%d fetched=%d commits=%v", err, attempts, r.fetched, r.committed)
	}
}

func TestConsumerCommitsSkippedRecords(t *testing.T) {
	r := &fakeReader{messages: []kafka.Message{{Value: nil}, {Value: []byte(`broken`)}, {Value: []byte(`{}`)}, {Value: []byte(`{"id":"png","content_type":"image/png"}`)}, {Value: []byte(`{"id":"missing-type"}`)}}}
	err := consume(context.Background(), r, func(context.Context, ImageEvent) error {
		t.Fatal("skipped record processed")
		return nil
	}, 0)
	if !errors.Is(err, io.EOF) || len(r.committed) != 5 {
		t.Fatalf("err=%v commits=%v", err, r.committed)
	}
}

func TestConsumerStopsOnCommitFailure(t *testing.T) {
	failure := errors.New("commit failed")
	r := &fakeReader{messages: []kafka.Message{{Value: nil}, {Value: nil}}, commitErr: failure}
	err := consume(context.Background(), r, nil, 0)
	if !errors.Is(err, failure) || r.fetched != 1 {
		t.Fatalf("err=%v fetched=%d", err, r.fetched)
	}
}

func TestConsumerCancellationLeavesEventUncommitted(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r := &fakeReader{messages: []kafka.Message{{Value: []byte(`{"id":"image","content_type":"image/jpeg"}`)}}}
	err := consume(ctx, r, func(context.Context, ImageEvent) error {
		cancel()
		return ctx.Err()
	}, time.Hour)
	if !errors.Is(err, context.Canceled) || len(r.committed) != 0 {
		t.Fatalf("err=%v commits=%v", err, r.committed)
	}
}
