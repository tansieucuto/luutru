// Gửi MỘT bức thư văn bản qua SMTP, chỉ dùng module có sẵn của Node (net, tls).
//
// Đủ cho AWS SES, Gmail và mọi máy chủ SMTP có TLS. Không thêm thư viện: máy chủ thật
// chạy Alpine, mỗi dependency là thêm một bước cài trên từng máy (CLAUDE.md §5.17).
//
// LƯU Ý: KHÔNG BAO GIỜ gửi mật khẩu qua kết nối trần. Cổng 465 bắt tay TLS ngay từ
// đầu; cổng khác bắt buộc STARTTLS, máy chủ không hỗ trợ thì dừng lại trước bước
// đăng nhập. Chứng chỉ luôn được kiểm (không có tùy chọn tắt).
const net = require('net');
const tls = require('tls');
const os = require('os');
const crypto = require('crypto');

class LoiSmtp extends Error {
  constructor(message, { code = null, buoc = '', chiTiet = '' } = {}) {
    super(message);
    this.smtpCode = code;
    this.buoc = buoc;
    this.chiTiet = chiTiet;
  }
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

// Bỏ CR/LF khỏi mọi giá trị đi vào header — chặn chèn header qua tên hay tiêu đề.
const motDong = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();

// Tiêu đề/tên có dấu phải mã hóa theo RFC 2047. Mỗi "encoded-word" tối đa 75 ký tự,
// nên cắt theo ký tự (không cắt giữa một chữ UTF-8) thành từng khúc ≤ 45 byte.
function maHoaTieuDe(s) {
  s = motDong(s);
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const khuc = [];
  let cur = '';
  for (const ch of s) {
    if (Buffer.byteLength(cur + ch, 'utf8') > 45) { khuc.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur) khuc.push(cur);
  return khuc.map((k) => `=?UTF-8?B?${b64(k)}?=`).join('\r\n ');
}

function tenNguoiGui(ten, email) {
  ten = motDong(ten).replace(/"/g, '');
  if (!ten) return `<${email}>`;
  return /^[\x20-\x7e]*$/.test(ten) ? `"${ten}" <${email}>` : `${maHoaTieuDe(ten)} <${email}>`;
}

function dungThu({ from, fromName, to, subject, text }) {
  const mien = String(from).split('@')[1] || 'localhost';
  const than = b64(String(text).replace(/\r?\n/g, '\r\n')).replace(/.{76}/g, '$&\r\n');
  return [
    `From: ${tenNguoiGui(fromName, from)}`,
    `To: <${to}>`,
    `Subject: ${maHoaTieuDe(subject)}`,
    `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${mien}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    than,
  ].join('\r\n');
}

// Đọc từng câu trả lời SMTP (có thể nhiều dòng: "250-..." rồi "250 ...").
class KetNoi {
  constructor(sock) {
    this.hang = [];     // câu trả lời đã nhận, chưa ai đọc
    this.cho = [];      // người đang đợi câu trả lời
    this.dong = [];
    this.buf = '';
    this.loi = null;
    this.gan(sock);
  }

  gan(sock) {
    if (this.sock) this.sock.removeAllListeners('data').removeAllListeners('error').removeAllListeners('close');
    this.sock = sock;
    this.buf = '';
    sock.on('data', (d) => this.nhan(d));
    sock.on('error', (e) => this.hong(e));
    sock.on('close', () => this.hong(new LoiSmtp('Máy chủ thư đóng kết nối giữa chừng.', { buoc: 'ket-noi' })));
  }

  nhan(d) {
    this.buf += d.toString('utf8');
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).replace(/\r$/, '');
      this.buf = this.buf.slice(i + 1);
      this.dong.push(line);
      if (/^\d{3}(?: |$)/.test(line)) {
        const traLoi = { code: Number(line.slice(0, 3)), lines: this.dong.splice(0) };
        const w = this.cho.shift();
        if (w) w.resolve(traLoi); else this.hang.push(traLoi);
      }
    }
  }

  hong(e) {
    if (!this.loi) this.loi = e;
    for (const w of this.cho.splice(0)) w.reject(this.loi);
  }

  doc() {
    if (this.hang.length) return Promise.resolve(this.hang.shift());
    if (this.loi) return Promise.reject(this.loi);
    return new Promise((resolve, reject) => this.cho.push({ resolve, reject }));
  }

  async lenh(cmd, mongDoi, buoc) {
    if (cmd !== null) this.sock.write(`${cmd}\r\n`);
    const r = await this.doc();
    if (!mongDoi.includes(r.code)) {
      throw new LoiSmtp(`Máy chủ thư trả ${r.code} ở bước ${buoc}`, {
        code: r.code, buoc, chiTiet: r.lines.join(' | ').slice(0, 300),
      });
    }
    return r;
  }
}

function moTls(opts) {
  return new Promise((resolve, reject) => {
    const s = tls.connect(opts, () => resolve(s));
    s.once('error', reject);
  });
}

function tenMay() {
  const h = os.hostname().replace(/[^A-Za-z0-9.-]/g, '');
  return h && h.includes('.') ? h : 'localhost';
}

/**
 * Gửi một thư. cfg: { host, port, user, pass }. Cổng 465/2465 = TLS ngay từ đầu,
 * cổng khác = STARTTLS bắt buộc. Ném LoiSmtp khi thất bại.
 */
async function gui(cfg, thu, { timeoutMs = 20000 } = {}) {
  const { host, port } = cfg;
  const tlsNgay = port === 465 || port === 2465;
  const from = motDong(thu.from);
  const to = motDong(thu.to);

  let conn = null;
  const hetGio = setTimeout(() => {
    conn?.hong(new LoiSmtp('Máy chủ thư không trả lời kịp.', { buoc: 'het-gio' }));
    conn?.sock.destroy();
  }, timeoutMs);

  try {
    let sock;
    try {
      sock = tlsNgay
        ? await moTls({ host, port, servername: host })
        : await new Promise((resolve, reject) => {
          const s = net.connect({ host, port }, () => resolve(s));
          s.once('error', reject);
        });
    } catch (e) {
      // Chứng chỉ sai là chuyện khác hẳn "không tới được máy chủ" — báo đúng tên.
      const loiChungChi = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME/i.test(String(e.code || ''));
      throw new LoiSmtp(loiChungChi ? 'Chứng chỉ TLS của máy chủ thư không hợp lệ.' : `Không kết nối được ${host}:${port}`,
        { buoc: loiChungChi ? 'tls' : 'ket-noi', chiTiet: e.code || e.message });
    }
    conn = new KetNoi(sock);

    await conn.lenh(null, [220], 'chào');
    let ehlo = await conn.lenh(`EHLO ${tenMay()}`, [250], 'EHLO');

    if (!tlsNgay) {
      if (!ehlo.lines.some((l) => /STARTTLS/i.test(l))) {
        throw new LoiSmtp('Máy chủ thư không hỗ trợ mã hóa (STARTTLS).', { buoc: 'starttls' });
      }
      await conn.lenh('STARTTLS', [220], 'STARTTLS');
      const tho = conn.sock;
      tho.removeAllListeners('data').removeAllListeners('error').removeAllListeners('close');
      let bocTls;
      try {
        bocTls = await moTls({ socket: tho, servername: host });
      } catch (e) {
        throw new LoiSmtp('Bắt tay TLS với máy chủ thư thất bại.', { buoc: 'tls', chiTiet: e.code || e.message });
      }
      conn.gan(bocTls);
      ehlo = await conn.lenh(`EHLO ${tenMay()}`, [250], 'EHLO');
    }

    if (cfg.user) {
      await conn.lenh(`AUTH PLAIN ${b64(`\0${cfg.user}\0${cfg.pass}`)}`, [235], 'đăng nhập');
    }
    await conn.lenh(`MAIL FROM:<${from}>`, [250], 'địa chỉ gửi');
    await conn.lenh(`RCPT TO:<${to}>`, [250, 251], 'địa chỉ nhận');
    await conn.lenh('DATA', [354], 'DATA');
    // Dòng bắt đầu bằng "." phải nhân đôi dấu chấm (RFC 5321 §4.5.2). Thân thư đã là
    // base64 nên thực tế không có, nhưng header thì chưa chắc.
    const data = dungThu({ ...thu, from, to }).replace(/^\./gm, '..');
    await conn.lenh(`${data}\r\n.`, [250], 'gửi nội dung');
    conn.sock.write('QUIT\r\n');
  } finally {
    clearTimeout(hetGio);
    conn?.sock.end();
  }
}

module.exports = { gui, LoiSmtp, dungThu };
