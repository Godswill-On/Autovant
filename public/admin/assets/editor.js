import { supabase } from '/js/common.js';

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Check Auth Session
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

    // 2. Load Existing Issues & Analytics Table
    loadAdminIssues();

    // 3. Handle Form Publishing
    const uploadForm = document.getElementById('upload-form');
    if (uploadForm) {
        uploadForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const submitBtn = uploadForm.querySelector('button[type="submit"]');
            submitBtn.disabled = true;
            submitBtn.textContent = 'Publishing...';

            try {
                const title = document.getElementById('issue-title').value;
                const issueNumber = parseInt(document.getElementById('issue-number').value, 10);
                const coverFile = document.getElementById('cover-file').files[0];
                const pdfFile = document.getElementById('pdf-file').files[0];

                if (!coverFile || !pdfFile) {
                    alert('Please select both a cover image and a PDF file.');
                    submitBtn.disabled = false;
                    submitBtn.textContent = 'Publish Issue';
                    return;
                }

                // Upload Cover Image to Supabase 'issues' bucket
                const coverExt = coverFile.name.split('.').pop();
                const coverFileName = `cover_${Date.now()}.${coverExt}`;
                const { data: coverData, error: coverError } = await supabase.storage
                    .from('issues')
                    .upload(coverFileName, coverFile);

                if (coverError) throw coverError;

                const coverUrl = supabase.storage.from('issues').getPublicUrl(coverFileName).data.publicUrl;

                // Upload PDF to Supabase 'issues' bucket
                const pdfFileName = `pdf_${Date.now()}.pdf`;
                const { data: pdfData, error: pdfError } = await supabase.storage
                    .from('issues')
                    .upload(pdfFileName, pdfFile);

                if (pdfError) throw pdfError;

                const pdfUrl = supabase.storage.from('issues').getPublicUrl(pdfFileName).data.publicUrl;

                // Insert into Supabase 'issues' table
                const { error: dbError } = await supabase
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

                if (dbError) throw dbError;

                alert('Issue published successfully!');
                uploadForm.reset();
                loadAdminIssues();

            } catch (err) {
                console.error('Publishing error:', err);
                alert('Error publishing issue: ' + err.message);
            } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Publish Issue';
            }
        });
    }
});

async function loadAdminIssues() {
    const tableBody = document.getElementById('admin-issues-table');
    if (!tableBody) return;

    const { data: issues, error } = await supabase
        .from('issues')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Failed to load issues:', error);
        return;
    }

    tableBody.innerHTML = '';
    if (issues.length === 0) {
        tableBody.innerHTML = '<tr><td colspan="2" style="padding:12px; color: #888;">No issues published yet.</td></tr>';
        return;
    }

    issues.forEach(issue => {
        const row = document.createElement('tr');
        row.style.borderBottom = '1px solid rgba(255, 255, 255, 0.1)';
        row.innerHTML = `
            <td style="padding:12px; font-weight:600;">Issue #${issue.issue_number}: ${issue.title}</td>
            <td style="padding:12px; color:#F1A139; font-weight:bold;">${issue.views_count || 0} views</td>
        `;
        tableBody.appendChild(row);
    });
}