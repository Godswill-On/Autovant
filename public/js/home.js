import { supabase } from '/js/common.js';

document.addEventListener('DOMContentLoaded', async () => {
    const issuesGrid = document.getElementById('issues-grid');
    if (!issuesGrid) return;

    try {
        const { data: issues, error } = await supabase
            .from('issues')
            .select('*')
            .order('issue_number', { ascending: false });

        if (error) {
            console.error('Supabase error fetching issues:', error.message);
            issuesGrid.innerHTML = `<p style="color: #f87171;">Failed to load issues: ${error.message}</p>`;
            return;
        }

        issuesGrid.innerHTML = '';
        
        if (!issues || issues.length === 0) {
            issuesGrid.innerHTML = '<p style="color: var(--text-muted);">No issues published yet. Check back soon!</p>';
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
        console.error('Unexpected error loading home issues:', err);
    }
});