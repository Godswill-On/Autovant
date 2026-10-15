import * as pdfjsLib from 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.mjs';

export async function initReader(issueId, pdfUrl) {
    try {
        // Automatically increment view counter when issue is opened
        await supabase.rpc('increment_issue_views', { row_id: issueId });
    } catch (err) {
        console.error('Failed to increment view count:', err);
    }

    const loadingTask = pdfjsLib.getDocument(pdfUrl);
    const pdfDoc = await loadingTask.promise;
    const bookContainer = document.getElementById('book-container');
    bookContainer.innerHTML = '';

    for (let pageNum = 1; pageNum <= pdfDoc.numPages; pageNum++) {
        const page = await pdfDoc.getPage(pageNum);
        const viewport = page.getViewport({ scale: 1.5 });
        
        const pageDiv = document.createElement('div');
        pageDiv.className = 'page-sheet';
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;
        
        await page.render({ canvasContext: context, viewport: viewport }).promise;
        pageDiv.appendChild(canvas);
        bookContainer.appendChild(pageDiv);
    }
}