import { supabase } from '/js/common.js';

document.addEventListener('DOMContentLoaded', async () => {
    const issuesGrid = document.getElementById('issues-grid');
    if (!issuesGrid) return;

    const { data: issues, error } = await supabase
        .from('issues')
        .select('*')
        .order('issue_number', { ascending: false });

    if (error) {
        console.error('Error fetching issues:', error);
        return;
    }

    issuesGrid.innerHTML = '';
    if (issues.length === 0) {
        issuesGrid.innerHTML = '<p style="color: #aaa;">No issues published yet. Stay tuned!</p>';
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
});