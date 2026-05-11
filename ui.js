// ============================================
// UI-REL Design Review Plugin - UI Logic
// (standalone file — logic is also inlined in ui.html)
// ============================================

let state = {
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

window.addEventListener('message', (event) => {
    const msg = event.data.pluginMessage || {};
    const { type, data } = msg;

    switch (type) {
        case 'design-captured':
            handleDesignCaptured(data);
            break;
        case 'error':
            showStatus(data.message, 'error');
            break;
        case 'log':
            console.log('[Plugin]', data.message);
            break;
    }
});

document.addEventListener('DOMContentLoaded', () => {
    setupDragDrop();
    document.getElementById('selectFrameBtn').addEventListener('click', selectFrame);
    document.getElementById('uploadArea').addEventListener('click', () => document.getElementById('fileInput').click());
    document.getElementById('fileInput').addEventListener('change', handleFileUpload);
    document.getElementById('compareBtn').addEventListener('click', startComparison);
    document.getElementById('exportBtn').addEventListener('click', exportResult);
    document.getElementById('resetBtn').addEventListener('click', resetAll);

    document.querySelectorAll('.v-btn').forEach(btn => {
        btn.addEventListener('click', () => setViewMode(btn.dataset.mode));
    });

    document.getElementById('sensitivitySlider').addEventListener('input', (e) => updateSensitivity(e.target.value));
    document.getElementById('opacitySlider').addEventListener('input', (e) => updateOpacity(e.target.value));

    document.getElementById('opToggleSwap').addEventListener('click', toggleOpacity);

    parent.postMessage({ pluginMessage: { type: 'request-current-selection' } }, '*');
});

function selectFrame() {
    showStatus('请在 Figma 中选择一个 Frame...', 'info');
    parent.postMessage({ pluginMessage: { type: 'select-frame' } }, '*');
}

function handleDesignCaptured(data) {
    if (!data || !data.imageDataUrl) {
        showStatus('未能获取设计稿图片，请确认已选中有效的 Frame', 'error');
        return;
    }

    const img = new Image();
    img.onload = () => {
        state.designImage = img;
        state.designWidth = img.width;
        state.designHeight = img.height;
        state.selectedFrameName = data.frameName || 'Selected Frame';

        document.getElementById('frameSelector').className = 'frame-card active';
        document.getElementById('frameSelector').innerHTML =
            '<div class="frame-info-row">' +
            '<div class="frame-icon-sm">F</div>' +
            '<div><div class="frame-name-text">' + escapeHtml(state.selectedFrameName) + '</div>' +
            '<div class="frame-dims">' + img.width + ' x ' + img.height + ' px</div></div>' +
            '</div>';

        const btn = document.getElementById('selectFrameBtn');
        btn.className = 'btn-select-frame captured';
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20,6 9,17 4,12"/></svg> 已捕获设计稿';
        btn.disabled = true;

        document.getElementById('designPreview').src = data.imageDataUrl;
        document.getElementById('designSize').textContent = `${img.width}×${img.height}`;
        document.getElementById('previewSection').style.display = 'block';

        showStatus(`成功捕获设计稿: ${state.selectedFrameName} (${img.width}×${img.height})`, 'success');
        checkReadyToCompare();
    };
    img.src = data.imageDataUrl;
}

function setupDragDrop() {
    const uploadArea = document.getElementById('uploadArea');
    ['dragenter', 'dragover'].forEach(name => {
        uploadArea.addEventListener(name, (e) => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });
    });
    ['dragleave', 'drop'].forEach(name => {
        uploadArea.addEventListener(name, (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
        });
    });
    uploadArea.addEventListener('drop', (e) => {
        if (e.dataTransfer.files.length > 0) processFile(e.dataTransfer.files[0]);
    });
}

function handleFileUpload(event) {
    if (event.target.files[0]) processFile(event.target.files[0]);
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

function checkReadyToCompare() {
    if (state.designImage && state.screenshotImage) {
        document.getElementById('compareBtn').disabled = false;
    }
}

function startComparison() {
    if (!state.designImage || !state.screenshotImage) {
        showStatus('请先完成设计稿选择和截图上传', 'error');
        return;
    }

    if (state.designWidth !== state.screenshotWidth || state.designHeight !== state.screenshotHeight) {
        showStatus(
            `尺寸不一致！设计稿: ${state.designWidth}×${state.designHeight}，截图: ${state.screenshotWidth}×${state.screenshotHeight}。请上传相同尺寸的截图。`,
            'error'
        );
        return;
    }

    const btn = document.getElementById('compareBtn');
    btn.innerHTML = '<span class="spinner"></span> 分析中...';
    btn.disabled = true;

    setTimeout(() => {
        try {
            performComparison();

            // Show results
            document.getElementById('resultSection').classList.add('visible');

            // Show canvas, hide placeholder
            document.getElementById('canvasPlaceholder').style.display = 'none';
            const cvs = document.getElementById('comparisonCanvas');
            cvs.style.display = 'block';

            renderComparison();

            btn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="20,6 9,17 4,12"/>
                </svg>
                分析完成`;

            showStatus('差异分析完成！可切换查看模式进行对比', 'success');
        } catch (err) {
            console.error(err);
            showStatus(`分析出错: ${err.message}`, 'error');
            btn.disabled = false;
            btn.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/><path d="M11 8v6M8 11h6"/>
                </svg>
                开始差异分析`;
        }
    }, 100);
}

function performComparison() {
    const dc = createCanvas(state.designImage);
    const sc = createCanvas(state.screenshotImage);
    const targetW = state.designWidth;
    const targetH = state.designHeight;
    const designCtx = dc.ctx;
    const screenshotCtx = sc.ctx;
    const designData = designCtx.getImageData(0, 0, targetW, targetH);
    const screenshotData = screenshotCtx.getImageData(0, 0, targetW, targetH);

    const diffPixels = new Uint8ClampedArray(targetW * targetH * 4);
    let maxDiffValue = 0, diffPixelCount = 0;
    const threshold = state.sensitivity;
    const totalPixels = targetW * targetH;

    for (let i = 0; i < totalPixels; i++) {
        const idx = i * 4;
        const dr = designData.data[idx] - screenshotData.data[idx];
        const dg = designData.data[idx+1] - screenshotData.data[idx+1];
        const db = designData.data[idx+2] - screenshotData.data[idx+2];
        const dv = Math.sqrt(dr*dr + dg*dg + db*db);
        if (dv >= threshold) {
            diffPixelCount++;
            maxDiffValue = Math.max(maxDiffValue, dv);
        }
        diffPixels[idx] = dv; diffPixels[idx+1] = dv; diffPixels[idx+2] = dv;
        diffPixels[idx+3] = dv >= threshold ? 255 : 0;
    }

    state.diffData = {
        pixels: diffPixels, width: targetW, height: targetH,
        designImageData: designData, screenshotImageData: screenshotData,
        totalPixels, diffPixelCount,
        maxDiffValue: Math.max(maxDiffValue, 1), threshold
    };

    const dp = (diffPixelCount / totalPixels * 100).toFixed(2);
    const percentEl = document.getElementById('diffPercent');
    percentEl.textContent = `${dp}%`;
    if (parseFloat(dp) >= 15) percentEl.className = 'stat-val danger';
    else if (parseFloat(dp) >= 5) percentEl.className = 'stat-val warn';
    else percentEl.className = 'stat-val';

    document.getElementById('diffPixels').textContent = formatNumber(diffPixelCount);
    document.getElementById('similarityScore').textContent = `${(100 - parseFloat(dp)).toFixed(2)}%`;
}

function renderComparison() {
    if (!state.diffData) return;

    const canvas = document.getElementById('comparisonCanvas');
    const container = document.getElementById('canvasContainer');
    const w = state.diffData.width, h = state.diffData.height;

    if (state.viewMode === 'sidebyside') {
        // Two full images side by side
        const gap = 6;
        let availW = container.clientWidth - 40;
        let availH = container.clientHeight - 40;
        availW = Math.max(availW, 400);
        availH = Math.max(availH, 200);
        const singleW = Math.floor((availW - gap) / 2);
        const sc = Math.min(singleW / w, availH / h, 1);
        const imgDrawW = Math.max(1, Math.round(w * sc));
        const imgDrawH = Math.max(1, Math.round(h * sc));

        canvas.width = imgDrawW * 2 + gap;
        canvas.height = imgDrawH;

        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Left: design
        const dOff = document.createElement('canvas'); dOff.width=w; dOff.height=h;
        dOff.getContext('2d').putImageData(state.diffData.designImageData, 0, 0);
        ctx.drawImage(dOff, 0, 0, imgDrawW, imgDrawH);

        // Right: screenshot
        const sOff = document.createElement('canvas'); sOff.width=w; sOff.height=h;
        sOff.getContext('2d').putImageData(state.diffData.screenshotImageData, 0, 0);
        ctx.drawImage(sOff, imgDrawW + gap, 0, imgDrawW, imgDrawH);

        ctx.font='12px Outfit,sans-serif'; ctx.fillStyle='#8888a0';
        ctx.textAlign='center';
        ctx.fillText('设计稿', imgDrawW/2, 18);
        ctx.fillText('实机截图', imgDrawW + gap + imgDrawW/2, 18);
    } else {
        let availW = container.clientWidth - 40;
        let availH = container.clientHeight - 40;
        availW = Math.max(availW, 200);
        availH = Math.max(availH, 200);
        const sc = Math.min(availW / w, availH / h, 1);

        canvas.width = Math.max(1, Math.round(w * sc));
        canvas.height = Math.max(1, Math.round(h * sc));

        const offscreen = document.createElement('canvas');
        offscreen.width = w; offscreen.height = h;
        const offCtx = offscreen.getContext('2d');

        switch (state.viewMode) {
            case 'heatmap':    renderHeatmap(offCtx, w, h);    break;
            case 'overlay':    renderOverlay(offCtx, w, h);    break;
            case 'diffonly':   renderDiffOnly(offCtx, w, h);   break;
        }

        const ctx = canvas.getContext('2d');
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(offscreen, 0, 0, canvas.width, canvas.height);
    }
}

function renderHeatmap(ctx, w, h) {
    const { pixels, maxDiffValue, threshold, designImageData } = state.diffData;
    ctx.putImageData(designImageData, 0, 0);
    const heat = ctx.createImageData(w, h);
    for (let i = 0; i < w*h; i++) {
        const idx = i*4, val = pixels[idx];
        if (val >= threshold) {
            const intensity = Math.min(val/maxDiffValue, 1);
            const [r, g, b] = getHeatmapColor(intensity);
            heat.data[idx]=r; heat.data[idx+1]=g; heat.data[idx+2]=b;
            heat.data[idx+3] = Math.floor(intensity * 200);
        }
    }
    ctx.globalAlpha=0.85; ctx.globalCompositeOperation='screen';
    ctx.putImageData(heat, 0, 0);
    ctx.globalCompositeOperation='source-over'; ctx.globalAlpha=1;
}

function renderOverlay(ctx, w, h) {
    const { designImageData, screenshotImageData } = state.diffData;
    ctx.putImageData(designImageData, 0, 0);
    ctx.globalAlpha = state.opacity / 100;
    const tmp = document.createElement('canvas'); tmp.width=w; tmp.height=h;
    tmp.getContext('2d').putImageData(screenshotImageData, 0, 0);
    ctx.drawImage(tmp, 0, 0); ctx.globalAlpha=1;
}

function renderDiffOnly(ctx, w, h) {
    const { pixels, maxDiffValue, threshold, designImageData } = state.diffData;
    const bg = new Uint8ClampedArray(designImageData.data.length);
    for (let i = 0; i < bg.length; i += 4) {
        const src = designImageData.data;
        const g = src[i] * 0.299 + src[i+1] * 0.587 + src[i+2] * 0.114;
        bg[i] = g * 0.5; bg[i+1] = g * 0.5; bg[i+2] = g * 0.5;
        bg[i+3] = 255;
    }
    ctx.putImageData(new ImageData(bg, w, h), 0, 0);
    const hl = ctx.createImageData(w, h);
    for (let i=0;i<w*h;i++) {
        const idx=i*4, val=pixels[idx];
        if (val>=threshold) {
            const [r,g,b] = getHeatmapColor(Math.min(val/maxDiffValue,1));
            hl.data[idx]=r; hl.data[idx+1]=g; hl.data[idx+2]=b; hl.data[idx+3]=230;
        }
    }
    ctx.globalCompositeOperation='screen'; ctx.putImageData(hl, 0, 0);
    ctx.globalCompositeOperation='source-over';
}

function getHeatmapColor(t) {
    const colors = [
        [0,0,128],[0,100,200],[0,200,200],[0,220,120],
        [60,220,60],[180,220,40],[240,180,20],[245,100,30],
        [240,40,40],[180,10,40]
    ];
    const idx = t*(colors.length-1), lo=Math.floor(idx), hi=Math.min(lo+1,colors.length-1), f=idx-lo;
    return [
        Math.round(colors[lo][0]+(colors[hi][0]-colors[lo][0])*f),
        Math.round(colors[lo][1]+(colors[hi][1]-colors[lo][1])*f),
        Math.round(colors[lo][2]+(colors[hi][2]-colors[lo][2])*f)
    ];
}

function setViewMode(mode) {
    state.viewMode = mode;
    document.querySelectorAll('.v-btn').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.mode === mode)
    );
    const opGroup = document.getElementById('opacityGroup');
    if (opGroup) opGroup.style.display = (mode === 'overlay') ? 'flex' : 'none';
    renderComparison();
}

function updateSensitivity(v) {
    state.sensitivity = parseInt(v);
    document.getElementById('sensitivityValue').textContent = v;
    if (state.diffData && state.designImage && state.screenshotImage) {
        performComparison(); renderComparison();
    }
}
function updateOpacity(v) {
    state.opacity = parseInt(v);
    document.getElementById('opacityValue').textContent = `${v}%`;
    if (state.viewMode === 'overlay' && state.diffData) renderComparison();
}

function toggleOpacity() {
    const next = (state.opacity >= 50) ? 0 : 100;
    document.getElementById('opacitySlider').value = next;
    updateOpacity(next);
}

function exportResult() {
    if (!state.diffData) return;
    const ec = document.createElement('canvas'), s=2, d=state.diffData;
    ec.width=d.width*s; ec.height=d.height*s;
    const ecx=ec.getContext('2d'); ecx.scale(s,s);
    ecx.putImageData(d.designImageData, 0, 0);
    const hd=ecx.createImageData(d.width, d.height);
    for (let i=0;i<d.width*d.height;i++) {
        const idx=i*4, val=d.pixels[idx];
        if (val>=d.threshold) {
            const c=getHeatmapColor(Math.min(val/d.maxDiffValue,1));
            hd.data[idx]=c[0]; hd.data[idx+1]=c[1]; hd.data[idx+2]=c[2];
            hd.data[idx+3]=Math.floor(Math.min(val/d.maxDiffValue,1)*210);
        }
    }
    ecx.globalAlpha=0.85; ecx.globalCompositeOperation='screen'; ecx.putImageData(hd, 0, 0);
    ec.toBlob((blob) => {
        const url=URL.createObjectURL(blob), a=document.createElement('a');
        a.download=`ui-rel-review-${Date.now()}.png`; a.href=url; a.click();
        URL.revokeObjectURL(url);
        showStatus('热力图报告已导出！','success');
    }, 'image/png');
}

function resetAll() {
    state = {
        designImage:null,screenshotImage:null,designWidth:0,designHeight:0,
        screenshotWidth:0,screenshotHeight:0,diffData:null,sensitivity:30,
        opacity:50,viewMode:'heatmap',selectedFrameName:''
    };

    document.getElementById('frameSelector').className = 'frame-card';
    document.getElementById('frameSelector').innerHTML = '<div class="no-frame">未选择 Frame</div>';

    const btn = document.getElementById('selectFrameBtn');
    btn.className = 'btn-select-frame';
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18M3 9h18"/></svg> 选择 Figma Frame`;
    btn.disabled = false;

    document.getElementById('uploadArea').style.display = 'block';
    document.getElementById('fileInput').value = '';
    document.getElementById('previewSection').style.display = 'none';
    document.getElementById('resultSection').classList.remove('visible');
    document.getElementById('canvasPlaceholder').style.display = 'flex';
    document.getElementById('comparisonCanvas').style.display = 'none';

    document.getElementById('sensitivitySlider').value = 30;
    document.getElementById('sensitivityValue').textContent = '30';
    document.getElementById('opacitySlider').value = 50;
    document.getElementById('opacityValue').textContent = '50%';
    document.querySelectorAll('.v-btn').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.mode === 'heatmap')
    );
    // reset opacity: slider already set to 50 in DOM reset above
    const opGroup = document.getElementById('opacityGroup');
    if (opGroup) opGroup.style.display = 'flex';

    showStatus('已重置，可以重新开始走查', 'info');
    parent.postMessage({ pluginMessage: { type: 'reset' } }, '*');
}

function createCanvas(img) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return { canvas: c, ctx: c.getContext('2d') };
}

function formatNumber(n) {
    if (n >= 1e6) return (n/1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
    return String(n);
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

function showStatus(msg, type = 'info') {
    const el = document.getElementById('statusMsg');
    const icons = {
        info: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>',
        success: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22,4 12,14.01 9,11.01"/></svg>',
        error: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M15 9l-6 6M9 9l6 6"/></svg>'
    };
    el.innerHTML = `<div class="status-msg ${type}">${icons[type]}${msg}</div>`;
    if (type !== 'error') {
        setTimeout(() => {
            if (el.lastChild && el.lastChild.textContent.includes(msg)) el.innerHTML = '';
        }, 5000);
    }
}
