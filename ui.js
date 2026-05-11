// ============================================
// UI-REL Design Review Plugin - UI Logic
// ============================================

// State
let state = {
    designImage: null,      // 设计稿 ImageData
    screenshotImage: null,  // 截图 ImageData
    designWidth: 0,
    designHeight: 0,
    screenshotWidth: 0,
    screenshotHeight: 0,
    diffData: null,         // 差异数据
    sensitivity: 30,        // 灵敏度阈值
    opacity: 50,            // 叠加透明度
    viewMode: 'heatmap',    // 当前视图模式
    selectedFrameName: ''
};

// Register message listener IMMEDIATELY (before any messages arrive from code.js)
// Use addEventListener to avoid being overwritten by Figma's injected scripts
window.addEventListener('message', (event) => {
    const msg = event.data.pluginMessage || {};
    const { type, data } = msg;
    
    console.log('[UI] received message:', type, data ? 'hasData' : 'noData');
    
    switch (type) {
        case 'design-captured':
            console.log('[UI] calling handleDesignCaptured...');
            handleDesignCaptured(data);
            break;
        case 'error':
            showStatus(data.message, 'error');
            break;
        case 'log':
            console.log('[Plugin]', data.message);
            break;
        default:
            console.log('[UI] Unknown message type:', type, msg);
    }
});

// Initialize after DOM ready
document.addEventListener('DOMContentLoaded', () => {
    setupDragDrop();
    
    // Bind all event listeners
    document.getElementById('selectFrameBtn').addEventListener('click', selectFrame);
    document.getElementById('uploadArea').addEventListener('click', () => document.getElementById('fileInput').click());
    document.getElementById('fileInput').addEventListener('change', handleFileUpload);
    document.getElementById('compareBtn').addEventListener('click', startComparison);
    document.getElementById('exportBtn').addEventListener('click', exportResult);
    document.getElementById('resetBtn').addEventListener('click', resetAll);
    
    // View mode toggle buttons
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.addEventListener('click', () => setViewMode(btn.dataset.mode));
    });
    
    // Slider controls
    document.getElementById('sensitivitySlider').addEventListener('input', (e) => updateSensitivity(e.target.value));
    document.getElementById('opacitySlider').addEventListener('input', (e) => updateOpacity(e.target.value));

    // Request current selection status from code.js on load
    parent.postMessage({ 
        pluginMessage: { type: 'request-current-selection' } 
    }, '*');
});

// ============================================
// Frame Selection
// ============================================
function selectFrame() {
    showStatus('请在 Figma 中选择一个 Frame...', 'info');
    parent.postMessage({ 
        pluginMessage: { type: 'select-frame' }
    }, '*');
}

// Handle captured design image from Figma
function handleDesignCaptured(data) {
    if (!data || !data.imageData) {
        showStatus('未能获取设计稿图片，请确认已选中有效的 Frame', 'error');
        return;
    }

    const img = new Image();
    img.onload = () => {
        state.designImage = img;
        state.designWidth = img.width;
        state.designHeight = img.height;
        state.selectedFrameName = data.frameName || 'Selected Frame';
        
        // Update UI
        document.getElementById('frameSelector').innerHTML = `
            <div class="frame-name">
                <span class="frame-icon">F</span>
                <span>${state.selectedFrameName}</span>
            </div>
            <div style="font-size:11px;color:var(--text-secondary);margin-top:4px;">
                ${img.width} x ${img.height}px
            </div>
        `;
        
        document.getElementById('selectFrameBtn').innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20,6 9,17 4,12"/>
            </svg>
            已捕获设计稿
        `;
        document.getElementById('selectFrameBtn').disabled = true;
        
        // Show preview
        document.getElementById('designPreview').src = data.imageDataUrl;
        document.getElementById('designSize').textContent = `${img.width}×${img.height}`;
        document.getElementById('previewSection').style.display = 'block';
        
        showStatus(`成功捕获设计稿: ${state.selectedFrameName} (${img.width}×${img.height})`, 'success');
        checkReadyToCompare();
    };
    img.src = data.imageDataUrl;
}

// ============================================
// File Upload
// ============================================
function setupDragDrop() {
    const uploadArea = document.getElementById('uploadArea');
    
    ['dragenter', 'dragover'].forEach(eventName => {
        uploadArea.addEventListener(eventName, (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = 'var(--primary-color)';
            uploadArea.style.background = 'rgba(99, 102, 241, 0.1)';
        });
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        uploadArea.addEventListener(eventName, (e) => {
            e.preventDefault();
            uploadArea.style.borderColor = '';
            uploadArea.style.background = '';
        });
    });
    
    uploadArea.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            processFile(files[0]);
        }
    });
}

function handleFileUpload(event) {
    const file = event.target.files[0];
    if (file) {
        processFile(file);
    }
}

function processFile(file) {
    if (!file.type.match(/image\/(png|jpeg|webp)/)) {
        showStatus('请上传 PNG、JPG 或 WEBP 格式的图片', 'error');
        return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            state.screenshotImage = img;
            state.screenshotWidth = img.width;
            state.screenshotHeight = img.height;

            // Update UI
            document.getElementById('uploadArea').style.display = 'none';
            document.getElementById('screenshotPreview').src = e.target.result;
            document.getElementById('screenshotSize').textContent = `${img.width}×${img.height}`;

            showStatus(`截图上传成功 (${img.width}×${img.height})`, 'success');
            checkReadyToCompare();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// ============================================
// Comparison Engine
// ============================================
function checkReadyToCompare() {
    const compareBtn = document.getElementById('compareBtn');
    if (state.designImage && state.screenshotImage) {
        compareBtn.disabled = false;
    }
}

function startComparison() {
    if (!state.designImage || !state.screenshotImage) {
        showStatus('请先完成 Step 1 和 Step 2', 'error');
        return;
    }

    const btn = document.getElementById('compareBtn');
    btn.innerHTML = '<span class="spinner"></span> 分析中...';
    btn.disabled = true;

    // Use setTimeout to allow UI update before heavy computation
    setTimeout(() => {
        try {
            performComparison();
            
            // Show results
            document.getElementById('resultSection').style.display = 'block';
            document.getElementById('comparisonArea').classList.add('visible');
            
            renderComparison();
            
            btn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20,6 9,17 4,12"/>
                </svg>
                分析完成
            `;
            
            showStatus('差异分析完成！可切换查看模式进行对比', 'success');
            
            // Scroll to results
            document.getElementById('resultSection').scrollIntoView({ behavior: 'smooth' });
        } catch (err) {
            console.error(err);
            showStatus(`分析出错: ${err.message}`, 'error');
            btn.disabled = false;
            btn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/><path d="M11 8v6M8 11h6"/>
                </svg>
                开始差异分析
            `;
        }
    }, 100);
}

function performComparison() {
    // Create canvases for pixel manipulation
    const designCanvas = createCanvas(state.designImage);
    const screenshotCanvas = createCanvas(state.screenshotImage);
    
    // Normalize sizes - resize to match dimensions for accurate comparison
    const targetW = Math.max(state.designWidth, state.screenshotWidth);
    const targetH = Math.max(state.designHeight, state.screenshotHeight);
    
    // Resize both images to the same size for comparison
    const normalizedDesign = resizeCanvas(designCanvas.canvas, targetW, targetH);
    const normalizedScreenshot = resizeCanvas(screenshotCanvas.canvas, targetW, targetH);
    
    const designCtx = normalizedDesign.getContext('2d');
    const screenshotCtx = normalizedScreenshot.getContext('2d');
    
    const designData = designCtx.getImageData(0, 0, targetW, targetH);
    const screenshotData = screenshotCtx.getImageData(0, 0, targetW, targetH);
    
    // Calculate per-pixel difference
    const diffPixels = new Uint8ClampedArray(targetW * targetH * 4);
    let totalDiff = 0;
    let maxDiffValue = 0;
    let diffPixelCount = 0;
    const totalPixels = targetW * targetH;
    
    const threshold = state.sensitivity; // Sensitivity threshold
    
    for (let i = 0; i < totalPixels; i++) {
        const idx = i * 4;
        
        // Get RGB values (ignore alpha)
        const dr = designData.data[idx] - screenshotData.data[idx];
        const dg = designData.data[idx + 1] - screenshotData.data[idx + 1];
        const db = designData.data[idx + 2] - screenshotData.data[idx + 2];
        
        // Calculate color distance (Euclidean in RGB space)
        const diffValue = Math.sqrt(dr * dr + dg * dg + db * db);
        
        if (diffValue >= threshold) {
            diffPixelCount++;
            totalDiff += diffValue;
            maxDiffValue = Math.max(maxDiffValue, diffValue);
        }
        
        // Store diff value for heatmap visualization
        diffPixels[idx] = diffValue;
        diffPixels[idx + 1] = diffValue;
        diffPixels[idx + 2] = diffValue;
        diffPixels[idx + 3] = diffValue >= threshold ? 255 : 0; // Alpha mask
    }
    
    // Store results
    state.diffData = {
        pixels: diffPixels,
        width: targetW,
        height: targetH,
        designImageData: designData,
        screenshotImageData: screenshotData,
        totalPixels,
        diffPixelCount,
        totalDiff,
        maxDiffValue: Math.max(maxDiffValue, 1), // Avoid division by zero
        threshold
    };
    
    // Update stats
    const diffPercent = ((diffPixelCount / totalPixels) * 100).toFixed(2);
    document.getElementById('diffPercent').textContent = `${diffPercent}%`;
    document.getElementById('diffPixels').textContent = formatNumber(diffPixelCount);
    
    const similarity = (100 - parseFloat(diffPercent)).toFixed(2);
    document.getElementById('similarityScore').textContent = `${similarity}%`;
    
    // Color-code the percentage based on severity
    const percentEl = document.getElementById('diffPercent');
    if (parseFloat(diffPercent) < 5) {
        percentEl.className = 'stat-value';
    } else if (parseFloat(diffPercent) < 15) {
        percentEl.className = 'stat-value';
        percentEl.style.color = 'var(--warning-color)';
    } else {
        percentEl.className = 'stat-value danger';
    }
}

// ============================================
// Rendering
// ============================================
function renderComparison() {
    if (!state.diffData) return;
    
    const canvas = document.getElementById('comparisonCanvas');
    const ctx = canvas.getContext('2d');
    const { width, height } = state.diffData;
    
    // Set canvas size (constrain for display)
    const maxWidth = 348; // Account for padding
    const scale = Math.min(maxWidth / width, maxWidth / height, 1);
    canvas.width = width * scale;
    canvas.height = height * scale;
    
    ctx.scale(scale, scale);

    switch (state.viewMode) {
        case 'heatmap':
            renderHeatmap(ctx, width, height);
            break;
        case 'overlay':
            renderOverlay(ctx, width, height);
            break;
        case 'sidebyside':
            renderSideBySide(ctx, width, height);
            break;
        case 'diffonly':
            renderDiffOnly(ctx, width, height);
            break;
    }
}

function renderHeatmap(ctx, w, h) {
    const { pixels, maxDiffValue, threshold, designImageData } = state.diffData;
    
    // Draw original design as background
    ctx.putImageData(designImageData, 0, 0);
    
    // Create heatmap overlay
    const heatData = ctx.createImageData(w, h);
    
    for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        const diffVal = pixels[idx];
        
        if (diffVal >= threshold) {
            // Normalize and apply colormap (blue -> yellow -> red)
            const intensity = Math.min(diffVal / maxDiffValue, 1);
            const [r, g, b] = getHeatmapColor(intensity);
            
            heatData.data[idx] = r;
            heatData.data[idx + 1] = g;
            heatData.data[idx + 2] = b;
            heatData.data[idx + 3] = Math.floor(intensity * 200); // Variable alpha
        }
    }
    
    // Apply heatmap overlay
    ctx.globalAlpha = 0.85;
    ctx.globalCompositeOperation = 'screen';
    ctx.putImageData(heatData, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
}

function renderOverlay(ctx, w, h) {
    const { designImageData, screenshotImageData } = state.diffData;
    
    // Draw design
    ctx.putImageData(designImageData, 0, 0);
    
    // Overlay screenshot with transparency
    const alpha = state.opacity / 100;
    ctx.globalAlpha = alpha;
    
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = w;
    tempCanvas.height = h;
    tempCanvas.getContext('2d').putImageData(screenshotImageData, 0, 0);
    
    ctx.drawImage(tempCanvas, 0, 0);
    ctx.globalAlpha = 1;
}

function renderSideBySide(ctx, w, h) {
    const { designImageData, screenshotImageData } = state.diffData;
    const halfW = w / 2;
    
    // Draw design on left
    const designHalf = ctx.createImageData(halfW, h);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < halfW; x++) {
            const srcIdx = (y * w + x) * 4;
            const dstIdx = (y * halfW + x) * 4;
            designHalf.data[dstIdx] = designImageData.data[srcIdx];
            designHalf.data[dstIdx + 1] = designImageData.data[srcIdx + 1];
            designHalf.data[dstIdx + 2] = designImageData.data[srcIdx + 2];
            designHalf.data[dstIdx + 3] = 255;
        }
    }
    ctx.putImageData(designHalf, 0, 0);
    
    // Draw divider line
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(halfW - 1, 0, 2, h);
    
    // Draw screenshot on right
    const shotHalf = ctx.createImageData(halfW, h);
    for (let y = 0; y < h; y++) {
        for (let x = halfW; x < w; x++) {
            const srcIdx = (y * w + x) * 4;
            const dstIdx = (y * halfW + (x - halfW)) * 4;
            shotHalf.data[dstIdx] = screenshotImageData.data[srcIdx];
            shotHalf.data[dstIdx + 1] = screenshotImageData.data[srcIdx + 1];
            shotHalf.data[dstIdx + 2] = screenshotImageData.data[srcIdx + 2];
            shotHalf.data[dstIdx + 3] = 255;
        }
    }
    ctx.putImageData(shotHalf, halfW, 0);
    
    // Add labels
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.fillText('设计稿', halfW / 2, 16);
    ctx.fillText('实机截图', halfW + halfW / 2, 16);
}

function renderDiffOnly(ctx, w, h) {
    const { pixels, maxDiffValue, threshold, designImageData } = state.diffData;
    
    // Draw desaturated design as background
    const bgData = new Uint8ClampedArray(designImageData.data);
    for (let i = 0; i < bgData.length; i += 4) {
        const gray = bgData[i] * 0.299 + bgData[i + 1] * 0.587 + bgData[i + 2] * 0.114;
        bgData[i] = gray * 0.5;
        bgData[i + 1] = gray * 0.5;
        bgData[i + 2] = gray * 0.5;
    }
    const bgImg = new ImageData(bgData, w, h);
    ctx.putImageData(bgImg, 0, 0);
    
    // Highlight only different areas
    const highlightData = ctx.createImageData(w, h);
    for (let i = 0; i < w * h; i++) {
        const idx = i * 4;
        const diffVal = pixels[idx];
        
        if (diffVal >= threshold) {
            const intensity = Math.min(diffVal / maxDiffValue, 1);
            const [r, g, b] = getHeatmapColor(intensity);
            highlightData.data[idx] = r;
            highlightData.data[idx + 1] = g;
            highlightData.data[idx + 2] = b;
            highlightData.data[idx + 3] = 230;
        }
    }
    
    ctx.globalCompositeOperation = 'screen';
    ctx.putImageData(highlightData, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
}

// Heatmap color mapping (blue -> cyan -> green -> yellow -> red)
function getHeatmapColor(t) {
    // t: 0 to 1
    const colors = [
        [0, 0, 128],       // Dark blue
        [0, 100, 200],     // Blue
        [0, 200, 200],     // Cyan
        [0, 220, 120],     // Green-cyan
        [60, 220, 60],     // Green-yellow
        [180, 220, 40],    // Yellow-green
        [240, 180, 20],    // Yellow-orange
        [245, 100, 30],    // Orange
        [240, 40, 40],     // Red-orange
        [180, 10, 40]      // Dark red
    ];
    
    const idx = t * (colors.length - 1);
    const low = Math.floor(idx);
    const high = Math.min(low + 1, colors.length - 1);
    const frac = idx - low;
    
    const r = colors[low][0] + (colors[high][0] - colors[low][0]) * frac;
    const g = colors[low][1] + (colors[high][1] - colors[low][1]) * frac;
    const b = colors[low][2] + (colors[high][2] - colors[low][2]) * frac;
    
    return [Math.round(r), Math.round(g), Math.round(b)];
}

// ============================================
// Controls
// ============================================
function setViewMode(mode) {
    state.viewMode = mode;
    
    // Update button states
    document.querySelectorAll('.view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    
    renderComparison();
}

function updateSensitivity(value) {
    state.sensitivity = parseInt(value);
    document.getElementById('sensitivityValue').textContent = value;
    
    // Re-run comparison with new sensitivity
    if (state.diffData && state.designImage && state.screenshotImage) {
        performComparison();
        renderComparison();
    }
}

function updateOpacity(value) {
    state.opacity = parseInt(value);
    document.getElementById('opacityValue').textContent = `${value}%`;
    
    if (state.viewMode === 'overlay' && state.diffData) {
        renderComparison();
    }
}

// ============================================
// Export
// ============================================
function exportResult() {
    if (!state.diffData) return;
    
    const canvas = document.getElementById('comparisonCanvas');
    
    // Create a larger export canvas
    const exportCanvas = document.createElement('canvas');
    const scale = 2; // Export at 2x resolution
    exportCanvas.width = state.diffData.width * scale;
    exportCanvas.height = state.diffData.height * scale;
    const ctx = exportCanvas.getContext('2d');
    ctx.scale(scale, scale);
    
    // Re-render at full resolution
    const { width, height, pixels, maxDiffValue, threshold, designImageData, screenshotImageData } = state.diffData;
    
    // Heatmap mode for export
    ctx.putImageData(designImageData, 0, 0);
    
    const heatData = ctx.createImageData(width, height);
    for (let i = 0; i < width * height; i++) {
        const idx = i * 4;
        const diffVal = pixels[idx];
        if (diffVal >= threshold) {
            const intensity = Math.min(diffVal / maxDiffValue, 1);
            const [r, g, b] = getHeatmapColor(intensity);
            heatData.data[idx] = r;
            heatData.data[idx + 1] = g;
            heatData.data[idx + 2] = b;
            heatData.data[idx + 3] = Math.floor(intensity * 210);
        }
    }
    
    ctx.globalAlpha = 0.85;
    ctx.globalCompositeOperation = 'screen';
    ctx.putImageData(heatData, 0, 0);
    
    // Convert to blob and download
    exportCanvas.toBlob((blob) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.download = `ui-rel-review-${Date.now()}.png`;
        link.href = url;
        link.click();
        URL.revokeObjectURL(url);
        showStatus('热力图报告已导出！', 'success');
    }, 'image/png');
}

// ============================================
// Reset
// ============================================
function resetAll() {
    state = {
        designImage: null,
        screenshotImage: null,
        designWidth: 0,
        designHeight: 0,
        screenshotWidth: 0,
        screenshotHeight: 0,
        diffData: null,
        sensitivity: 30,
        opacity: 50,
        viewMode: 'heatmap',
        selectedFrameName: ''
    };

    // Reset UI
    document.getElementById('frameSelector').innerHTML =
        '<div class="frame-name no-frame">未选择 Frame</div>';
    document.getElementById('selectFrameBtn').innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <path d="M9 3v18M3 9h18"/>
        </svg>
        选择 Figma Frame
    `;
    document.getElementById('selectFrameBtn').disabled = false;
    document.getElementById('uploadArea').style.display = 'block';
    document.getElementById('fileInput').value = '';
    document.getElementById('previewSection').style.display = 'none';
    document.getElementById('resultSection').style.display = 'none';

    // Reset controls
    document.getElementById('sensitivitySlider').value = 30;
    document.getElementById('sensitivityValue').textContent = '30';
    document.getElementById('opacitySlider').value = 50;
    document.getElementById('opacityValue').textContent = '50%';
    document.querySelectorAll('.view-btn').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.mode === 'heatmap')
    );

    showStatus('已重置，可以重新开始走查', 'info');

    // Notify main code
    parent.postMessage({
        pluginMessage: { type: 'reset' }
    }, '*');
}

// ============================================
// Utilities
// ============================================
function createCanvas(img) {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return { canvas, ctx };
}

function resizeCanvas(sourceCanvas, targetW, targetH) {
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(sourceCanvas, 0, 0, targetW, targetH);
    return canvas;
}

function formatNumber(num) {
    if (num >= 1000000) return (num / 1000000).toFixed(2) + 'M';
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
    return num.toString();
}

function showStatus(message, type = 'info') {
    const el = document.getElementById('statusMsg');
    const icons = {
        info: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
        success: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>',
        error: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>'
    };
    el.innerHTML = `<div class="status-msg ${type}">${icons[type]}${message}</div>`;
    
    // Auto-hide after 5 seconds for success/info
    if (type !== 'error') {
        setTimeout(() => {
            if (el.lastChild && el.lastChild.textContent.includes(message)) {
                el.innerHTML = '';
            }
        }, 5000);
    }
}
