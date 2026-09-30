"""Explicit acknowledgement and shutdown for replayable Kafka jobs."""
import logging
import os
import signal
import threading
from time import monotonic, time
from metrics import ACTIVE, POLL, COMMITTED, FAILURES, LAST_COMMIT, PROCESSING, start_exporter

log = logging.getLogger(__name__)


def consume(consumer, process, stopped=None):
    """Never advance past failed work; restart with its offset uncommitted."""
    stopped = stopped or threading.Event()
    if threading.current_thread() is threading.main_thread():
        signal.signal(signal.SIGTERM, lambda *_: stopped.set())
        signal.signal(signal.SIGINT, lambda *_: stopped.set())
    server, thread = start_exporter()
    POLL.set(time())
    try:
        while not stopped.is_set():
            with FAILURES.labels("poll").count_exceptions():
                message = consumer.poll(1)
                POLL.set(time())
                if message is not None and message.error():
                    raise RuntimeError(message.error())
            if message is None:
                continue
            started = monotonic()
            ACTIVE.set(time())
            try:
                with FAILURES.labels("process").count_exceptions():
                    process(message)
                with FAILURES.labels("commit").count_exceptions():
                    consumer.commit(message=message, asynchronous=False)
                COMMITTED.inc()
                LAST_COMMIT.set(time())
            finally:
                ACTIVE.set(0)
                PROCESSING.observe(monotonic() - started)
    finally:
        try:
            consumer.close()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


def kafka_security():
    config = {}
    if os.environ.get("KAFKA_TLS") == "true":
        config.update({"security.protocol": "SSL", "ssl.ca.location": os.environ["SSL_CERT_FILE"]})
    if os.environ.get("KAFKA_USERNAME"):
        config.update({
            "security.protocol": "SASL_SSL" if os.environ.get("KAFKA_TLS") == "true" else "SASL_PLAINTEXT",
            "sasl.mechanism": "SCRAM-SHA-512",
            "sasl.username": os.environ["KAFKA_USERNAME"],
            "sasl.password": os.environ["KAFKA_PASSWORD"],
        })
    return config


class PublishError(RuntimeError):
    """Kafka output delivery was not acknowledged before the deadline."""
