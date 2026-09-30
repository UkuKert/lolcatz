"""Single-process WSGI server with one request thread and optional TLS.

The current boto3/psycopg2 pipeline is synchronous; scale with replicas.
An async server needs async clients before it can safely overlap this work.
"""
import os
import signal
import ssl
import threading

from cheroot.ssl.builtin import BuiltinSSLAdapter
from cheroot.wsgi import Server

from app import create_app
from metrics import start_exporter


def main():
    server = Server(("::", int(os.environ.get("PORT", "8080"))), create_app(),
                    numthreads=1, shutdown_timeout=25)
    cert, key = os.environ.get("TLS_CERT_FILE"), os.environ.get("TLS_KEY_FILE")
    if bool(cert) != bool(key):
        raise ValueError("Configure both TLS_CERT_FILE and TLS_KEY_FILE")
    if cert:
        server.ssl_adapter = BuiltinSSLAdapter(cert, key)
        server.ssl_adapter.context.minimum_version = ssl.TLSVersion.TLSv1_2

        def reload_certificate(socket, _name, _context):
            context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            context.minimum_version = ssl.TLSVersion.TLSv1_2
            context.load_cert_chain(cert, key)
            socket.context = context

        server.ssl_adapter.context.set_servername_callback(reload_certificate)

    stopping = threading.Event()

    def stop(*_):
        # stop() waits for request threads; avoid blocking the accept loop in
        # Python's main-thread signal handler.
        if not stopping.is_set():
            stopping.set()
            threading.Thread(target=server.stop).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    exporter, exporter_thread = start_exporter()
    try:
        server.safe_start()
    finally:
        exporter.shutdown()
        exporter.server_close()
        exporter_thread.join(timeout=5)


if __name__ == "__main__":
    main()
