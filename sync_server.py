"""
E-LOG Local Sync Server & Offline Web Host
Serves E-LOG locally on desktop, and syncs across iPhone, Android, and PC over local Wi-Fi.

Run with:
    python sync_server.py
Then on desktop, open: http://localhost:8080
On iPhone / Android on same Wi-Fi, open: http://<YOUR_COMPUTER_IP>:8080
"""

import http.server
import socketserver
import json
import os
import socket
import urllib.parse

PORT = 8080
DATA_DIR = os.path.join(os.path.dirname(__file__), 'server_data')
os.makedirs(DATA_DIR, exist_ok=True)

def get_local_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))
        ip = s.getsockname()[0]
    except Exception:
        ip = '127.0.0.1'
    finally:
        s.close()
    return ip

class ELogHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Enable CORS and service worker support
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Cache-Control')
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_POST(self):
        # API Sync endpoint: /api/sync or /api/sync/<vault_code>
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path.startswith('/api/sync'):
            vault_code = path[len('/api/sync'):].strip('/').strip()
            if not vault_code:
                vault_code = 'E-LOG'

            content_length = int(self.headers.get('Content-Length', 0))
            body = self.rfile.read(content_length)

            try:
                data = json.loads(body.decode('utf-8'))
                vault_file = os.path.join(DATA_DIR, f"{vault_code}.json")
                with open(vault_file, 'w', encoding='utf-8') as f:
                    json.dump(data, f, indent=2)

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                entry_count = len(data.get('entries', []))
                self.wfile.write(json.dumps({
                    'success': True,
                    'vault': vault_code,
                    'entries': entry_count,
                    'message': f'Exported {entry_count} sorties to cloud vault ({vault_code})'
                }).encode('utf-8'))
                print(f"[SYNC] Uploaded vault: {vault_code} ({entry_count} sorties)")
            except Exception as e:
                self.send_error(500, str(e))
            return

        super().do_POST()

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        # Direct file download endpoint: /api/download or /api/download/<vault_code>
        if path.startswith('/api/download'):
            vault_code = path[len('/api/download'):].strip('/').strip()
            if not vault_code:
                vault_code = 'E-LOG'
            vault_file = os.path.join(DATA_DIR, f"{vault_code}.json")

            if not os.path.exists(vault_file):
                self.send_error(404, "Backup file not found on server")
                return

            try:
                with open(vault_file, 'rb') as f:
                    content = f.read()

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Disposition', f'attachment; filename="{vault_code}_Backup.json"')
                self.send_header('Content-Length', str(len(content)))
                self.end_headers()
                self.wfile.write(content)
                print(f"[DOWNLOAD] Delivered backup: {vault_code}.json")
            except Exception as e:
                self.send_error(500, str(e))
            return

        # API Sync endpoint: /api/sync or /api/sync/<vault_code>
        if path.startswith('/api/sync'):
            vault_code = path[len('/api/sync'):].strip('/').strip()
            if not vault_code:
                vault_code = 'E-LOG'
            vault_file = os.path.join(DATA_DIR, f"{vault_code}.json")

            if not os.path.exists(vault_file):
                self.send_response(404)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': False,
                    'message': f'Vault {vault_code} not found on server. Upload first.'
                }).encode('utf-8'))
                return

            try:
                with open(vault_file, 'r', encoding='utf-8') as f:
                    content = f.read()

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(content.encode('utf-8'))
                print(f"[SYNC] Retrieved vault: {vault_code}")
            except Exception as e:
                self.send_error(500, str(e))
            return

        super().do_GET()

if __name__ == '__main__':
    local_ip = get_local_ip()
    print("=" * 60)
    print("  E-LOG DIGITAL FLYING LOG BOOK SERVER")
    print("=" * 60)
    print(f"  Desktop URL:  http://localhost:{PORT}")
    print(f"  iPhone / LAN: http://{local_ip}:{PORT}")
    print("=" * 60)

    with socketserver.TCPServer(("", PORT), ELogHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")
