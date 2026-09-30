import importlib.util
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import unittest
from unittest.mock import Mock, patch

spec = importlib.util.spec_from_file_location("worker_runtime", Path(__file__).resolve().parents[1] / "worker_runtime.py")
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class ConsumerTests(unittest.TestCase):
    def setUp(self):
        exporter = patch.object(runtime, "start_exporter", return_value=(Mock(), Mock()))
        exporter.start()
        self.addCleanup(exporter.stop)
        self.message = Mock()
        self.message.error.return_value = None
        self.consumer = Mock()
        self.consumer.poll.return_value = self.message
        self.stopped = Mock()
        self.stopped.is_set.return_value = False
        self.stopped.wait.return_value = False

    def test_success_commits_before_shutdown(self):
        process = Mock()
        self.consumer.commit.side_effect = lambda **_: setattr(self.stopped.is_set, "return_value", True)
        runtime.consume(self.consumer, process, self.stopped)
        process.assert_called_once_with(self.message)
        self.consumer.commit.assert_called_once_with(message=self.message, asynchronous=False)
        self.consumer.close.assert_called_once()

    def test_failed_job_stops_without_acknowledgement(self):
        process = Mock(side_effect=OSError("unavailable"))
        with self.assertRaises(OSError):
            runtime.consume(self.consumer, process, self.stopped)
        self.assertEqual(process.call_count, 1)
        self.consumer.commit.assert_not_called()
        self.consumer.close.assert_called_once()

    def test_programming_error_propagates_without_acknowledgement(self):
        process = Mock(side_effect=TypeError("bug"))
        with self.assertRaises(TypeError):
            runtime.consume(self.consumer, process, self.stopped)
        self.assertEqual(process.call_count, 1)
        self.consumer.commit.assert_not_called()
        self.consumer.close.assert_called_once()

    def test_commit_failure_is_not_success(self):
        before = runtime.COMMITTED._value.get()
        failures = runtime.FAILURES.labels("commit")._value.get()
        self.consumer.commit.side_effect = OSError("commit rejected")
        with self.assertRaises(OSError):
            runtime.consume(self.consumer, Mock(), self.stopped)
        self.assertEqual(runtime.COMMITTED._value.get(), before)
        self.assertEqual(runtime.FAILURES.labels("commit")._value.get(), failures + 1)
        self.assertEqual(runtime.ACTIVE._value.get(), 0)

    def test_active_timestamp_set_during_work_and_cleared_after_commit(self):
        before = runtime.COMMITTED._value.get()
        def process(_):
            self.assertGreater(runtime.ACTIVE._value.get(), 0)
        self.consumer.commit.side_effect = lambda **_: setattr(self.stopped.is_set, "return_value", True)
        runtime.consume(self.consumer, process, self.stopped)
        self.assertEqual(runtime.COMMITTED._value.get(), before + 1)
        self.assertGreater(runtime.LAST_COMMIT._value.get(), 0)
        self.assertEqual(runtime.ACTIVE._value.get(), 0)
