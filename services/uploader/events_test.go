package main

import (
	"fmt"
	"testing"

	"github.com/segmentio/kafka-go"
)

func TestUploadAndTombstoneUseSamePartition(t *testing.T) {
	t.Setenv("KAFKA_BROKERS", "broker-a:9092,broker-b:9092")
	for _, topic := range []string{"lolcatz-images"} {
		t.Run(topic, func(t *testing.T) {
			writer := newEventWriter(topic)
			if writer.RequiredAcks != kafka.RequireAll {
				t.Fatal("image events require broker acknowledgements")
			}
			restarted := newEventWriter(topic)
			for i := 0; i < 100; i++ {
				key := []byte(fmt.Sprintf("image-%d", i))
				upload := kafka.Message{Key: key, Value: []byte(`{"id":"image"}`)}
				tombstone := kafka.Message{Key: key}
				partition := writer.Balancer.Balance(upload, 0, 1, 2)
				if writer.Balancer.Balance(tombstone, 0, 1, 2) != partition || restarted.Balancer.Balance(tombstone, 0, 1, 2) != partition {
					t.Fatalf("upload and tombstone for %s landed in different partitions", key)
				}
			}
		})
	}
}
