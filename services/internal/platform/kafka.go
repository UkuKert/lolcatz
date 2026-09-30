package platform

import (
	"github.com/segmentio/kafka-go/sasl"
	"github.com/segmentio/kafka-go/sasl/scram"
	"os"
)

func KafkaSASL() sasl.Mechanism {
	user := os.Getenv("KAFKA_USERNAME")
	if user == "" {
		return nil
	}
	password := os.Getenv("KAFKA_PASSWORD")
	if password == "" {
		panic("required env var KAFKA_PASSWORD is not set")
	}
	mechanism, err := scram.Mechanism(scram.SHA512, user, password)
	if err != nil {
		panic(err)
	}
	return mechanism
}
