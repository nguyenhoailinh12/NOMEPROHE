document.addEventListener('DOMContentLoaded', () => {
    const reportsListDiv = document.getElementById('reports-list');
    const refreshBtn = document.getElementById('refresh-btn');

    async function fetchAndRenderReports() {
        reportsListDiv.innerHTML = '<p>Đang tải danh sách tố cáo...</p>';
        try {
            const response = await fetch('http://localhost:3000/api/reports');
            if (!response.ok) {
                throw new Error(`Lỗi từ máy chủ: ${response.statusText}`);
            }
            const reports = await response.json();

            if (reports.length === 0) {
                reportsListDiv.innerHTML = '<p>Chưa có tố cáo nào.</p>';
                return;
            }

            renderReports(reports);
        } catch (error) {
            console.error('Lỗi khi lấy danh sách tố cáo:', error);
            reportsListDiv.innerHTML = `<p class="error">Không thể tải danh sách tố cáo. Máy chủ backend đang chạy chứ?</p>`;
        }
    }

    function renderReports(reports) {
        reportsListDiv.innerHTML = ''; // Clear loading message
        const ul = document.createElement('ul');
        ul.className = 'reports-ul';

        // Sắp xếp từ mới nhất đến cũ nhất
        reports.sort((a, b) => b.id - a.id).forEach(report => {
            const li = document.createElement('li');
            li.className = 'report-item';

            const reportDate = new Date(parseInt(report.id)).toLocaleString('vi-VN');

            let evidenceLink = 'Không có';
            if (report.evidenceFile) {
                // Link đến file được phục vụ bởi express.static
                evidenceLink = `<a href="http://localhost:3000/reports/${report.id}/${report.evidenceFile}" target="_blank" rel="noopener noreferrer">Xem bằng chứng</a>`;
            }

            li.innerHTML = `
                <div class="report-header">
                    <strong>Mã tố cáo:</strong> ${report.id} - <small>${reportDate}</small>
                </div>
                <div class="report-body">
                    <p><strong>Người tố cáo:</strong> ${report.reporter || 'N/A'}</p>
                    <p><strong>Người bị tố cáo:</strong> ${report.reported || 'N/A'}</p>
                    <p><strong>Lý do:</strong></p>
                    <pre>${report.reason || 'N/A'}</pre>
                    <p><strong>Bằng chứng:</strong> ${evidenceLink}</p>
                </div>
            `;
            ul.appendChild(li);
        });
        reportsListDiv.appendChild(ul);
    }

    refreshBtn.addEventListener('click', fetchAndRenderReports);

    // Initial load
    fetchAndRenderReports();
});
