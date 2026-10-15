import { supabase } from '/js/common.js';

document.addEventListener('DOMContentLoaded', async () => {
    const issuesGrid = document.getElementById('issues-grid');
    if (!issuesGrid) return;

    console.log("Fetching issues for public page...");

    try {
        const { data: issues, error } = await supabase
            .from('issues')
            .select('*')
            .order('issue_number', { ascending: false });

        if (error) {
            console.error('Supabase fetch error:', error);
            issuesGrid.innerHTML = `<p style="color: #f87171;">Error loading issues: ${error.message}</p>`;
            return;
        }

        console.log("Fetched issues data:", issues);

        issuesGrid.innerHTML = '';
        
        if (!issues || issues.length === 0) {
            issuesGrid.innerHTML = '<p style="color: var(--text-muted);">No issues published yet.</p>';
            return;
        }

        issues.forEach(issue => {
            const card = document.createElement('a');
            card.href = `/read.html?id=${issue.id}`;
            card.className = 'issue-card';
            card.innerHTML = `
                <div class="card-image-wrap">
                    <img src="${issue.cover_image_url}" alt="${issue.title}" />
                </div>
                <div class="card-info">
                    <h3>Issue #${issue.issue_number} — ${issue.title}</h3>
                    <span class="read-link">Read Issue &rarr;</span>
                </div>
            `;
            issuesGrid.appendChild(card);
        });

    } catch (err) {
        console.error('Unexpected error in home.js:', err);
    }
});