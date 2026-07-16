import './index.css'

// Kiểm tra cấu hình TRƯỚC khi nạp app. Nếu thiếu biến môi trường Supabase thì
// hiển thị thông báo rõ ràng thay vì trắng trang (createClient sẽ ném lỗi khi
// thiếu URL/key và làm hỏng toàn bộ app).
const root = document.getElementById('root')

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  root.innerHTML = `
    <div style="max-width:640px;margin:80px auto;padding:24px;border:1px solid #fecaca;
                background:#fef2f2;border-radius:12px;font-family:system-ui,sans-serif;color:#991b1b">
      <h2 style="margin:0 0 8px">⚠️ Thiếu cấu hình Supabase</h2>
      <p style="margin:0 0 8px;color:#7f1d1d">
        Ứng dụng chưa nhận được <code>VITE_SUPABASE_URL</code> và/hoặc
        <code>VITE_SUPABASE_ANON_KEY</code>.
      </p>
      <p style="margin:0;color:#7f1d1d">
        Nếu chạy trên GitHub Pages: kiểm tra <b>Settings → Secrets and variables → Actions</b>
        đã có 2 secret này với giá trị đúng, rồi chạy lại workflow deploy.
      </p>
    </div>`
} else {
  // Chỉ nạp app (và supabase client) khi đã có cấu hình
  import('./bootstrap.jsx')
}
