// Tách khỏi index.html vì CSP đặt script-src 'self' (script nội tuyến bị chặn).
window.location.replace(sessionStorage.getItem('beacon_admin_token') ? 'admin.html' : 'login.html');
