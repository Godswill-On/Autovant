import { supabase } from '/js/common.js';

document.addEventListener('DOMContentLoaded', async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
        window.location.href = '/admin/login.html';
        return;
    }

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await supabase.auth.signOut();
            window.location.href = '/admin/login.html';
        });
    }

    loadAdminAnalytics();

    const form = document.getElementById('upload-form');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = form.querySelector('button[type="submit"]');
            btn.disabled = true;
            btn.textContent = 'Publishing...';

            try {
                const title = document.getElementById('issue-title').value.trim();
                const issueNumber = parseInt(document.getElementById('issue-number').value, 10);
                const coverFile = document.getElementById('cover-file').files[0];
                const pdfFile = document.getElementById('pdf-file').files[0];

                if (!coverFile || !pdfFile) {
                    alert('Please select both a cover image and a PDF file.');
                    btn.disabled = false;
                    btn.textContent = 'Publish Issue';
                    return;
                }

                // 1. Upload Cover Image
                const coverExt = coverFile.name.split('.').pop();
                const coverName = `cover_${Date.now()}.${coverExt}`;
                const { error: coverErr } = await supabase.storage
                    .from('issues')
                    .upload(coverName, coverFile);

                if (coverErr) throw new Error('Cover upload failed: ' + coverErr.message);

                const coverUrl = supabase.storage.from('issues').getPublicUrl(coverName).data.publicUrl;

                // 2. Upload PDF File
                const pdfName = `pdf_${Date.now()}.pdf`;
                const { error: pdfErr } = await supabase.storage
                    .from('issues')
                    .upload(pdfName, pdfFile);

                if (pdfErr) throw new Error('PDF upload failed: ' + pdfErr.message);

                const pdfUrl = supabase.storage.from('issues').getPublicUrl(pdfName).data.publicUrl;

                // 3. Insert into database
                const { error: dbErr } = await supabase
                    .from('issues')
                    .insert([
                        {
                            title: title,
                            issue_number: issueNumber,
                            cover_image_url: coverUrl,
                            pdf_url: pdfUrl,
                            views_count: 0
                        }
                    ]);

                if (dbErr) throw new Error('Database insert failed: ' + dbErr.message);

                alert('Issue published successfully!');
                form.reset();
                loadAdminAnalytics();

            } catch (err) {
                console.error('Publishing error:', err);
                alert('Error publishing issue: ' + err.message);
            } finally {
                btn.disabled = false;
                btn.textContent = 'Publish Issue';
            }
        });
    }
});

async function loadAdminAnalytics() {
    const tableBody = document.getElementById('admin-issues-table');
    if (!tableBody) return;

    const { data: issues, error } = await supabase
        .from('issues')
        .select('*')
        .order('issue_number', { ascending: false });

    if (error) {
        tableBody.innerHTML = `<tr><td colspan="2" style="padding: 15px; color: #f87171;">Error: ${error.message}</td></tr>`;
        return;
    }

    tableBody.innerHTML = '';
    if (!issues || issues.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="2" style="padding: 15px; color: var(--text-muted);">No issues published yet.</td></tr>';
        return;
    }

    issues.forEach(issue => {
        const row = document.createElement('tr');
        row.style.borderBottom = '1px solid var(--border)';
        row.innerHTML = `
            <td style="padding: 12px; font-weight: 500;">Issue #${issue.issue_number}: ${issue.title}</td>
            <td style="padding: 12px; color: #c084fc; font-weight: bold;">${issue.views_count || 0} views</td>
        `;
        tableBody.appendChild(row);
    });
}