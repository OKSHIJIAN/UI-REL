// ============================================
// UI-REL Design Review Plugin - Main Plugin Code
// ============================================
// This runs in the Figma sandbox and handles:
// - Frame selection (single & multi)
// - Image capture/export
// - Communication with UI

let selectedFrame = null;
let isCapturing = false; // 防抖：防止重复触发导出
let capturedFrameNames = []; // UI端已捕获的frameName列表

// Listen for messages from UI
figma.showUI(__html__, { width: 1000, height: 800 });

figma.ui.onmessage = async (msg) => {
    switch (msg.type) {
        case 'select-frame':
            await handleFrameSelection();
            break;
        case 'capture-all-selected':
            await captureAllSelectedFrames();
            break;
        case 'reset':
            selectedFrame = null;
            isCapturing = false;
            capturedFrameNames = [];
            figma.currentPage.selection = [];
            break;
        case 'request-current-selection':
            const sel = figma.currentPage.selection;
            if (sel.length > 0) {
                handleFrameSelection();
            }
            break;
        case 'captured-frame-names':
            // UI回传已有的frameName列表，用于增量捕获去重
            capturedFrameNames = msg.names || [];
            console.log('[code.js] received captured names:', capturedFrameNames);
            break;
        default:
            console.log('Unknown message type:', msg.type);
    }
};

// Listen for selection changes - auto-detect frame(s)
figma.on('selectionchange', () => {
    const selection = figma.currentPage.selection;
    console.log('[code.js] selectionchange triggered, count:', selection.length, 'isCapturing:', isCapturing);
    
    if (isCapturing) {
        console.log('[code.js] selectionchange skipped: capture in progress');
        return; // 捕获中不响应 selection 变化
    }
    
    if (selection.length > 0) {
        const validFrames = findValidFramesFromSelection(selection);
        console.log('[code.js] validFrames found:', validFrames.length);
        
        if (validFrames.length >= 1) {
            // 无论选中几个，都走 handleFrameSelection 逻辑
            // 多选时自动批量捕获
            selectedFrame = validFrames[0];

            if (validFrames.length === 1) {
                // 单选：直接捕获
                captureAndSendImage(validFrames[0]);
            } else {
                // 多选：自动批量捕获（过滤已存在的，只发新增的）
                if (isCapturing) return;
                console.log('[code.js] auto batch-capturing', validFrames.length, 'frames, captured:', capturedFrameNames.length);
                figma.ui.postMessage({
                    pluginMessage: {
                        type: 'multi-selection-detected',
                        data: {
                            count: validFrames.length,
                            frames: validFrames.map(f => ({ name: f.name, type: f.type, width: f.width, height: f.height }))
                        }
                    }
                });
                // isCapturing 在内部函数里设置
                captureAllSelectedFramesInternal(validFrames, capturedFrameNames);
            }
        } else {
            // Fallback: try to find any frame on the page
            const pageFrames = findFrames(figma.currentPage);
            if (pageFrames.length > 0 && !isCapturing) {
                selectedFrame = pageFrames[0];
                captureAndSendImage(pageFrames[0]);
            } else {
                figma.ui.postMessage({
                    pluginMessage: {
                        type: 'error',
                        message: `选中 "${selection[0].name}" (类型: ${selection[0].type}) 无法识别为 Frame。页面上也没有其他 Frame。`
                    }
                });
            }
        }
    }
});

// Also check initial selection on plugin open
setTimeout(() => {
    const selection = figma.currentPage.selection;
    if (selection.length > 0) {
        handleFrameSelection();
    }
}, 500);

// Handle frame selection (supports both single & multi)
async function handleFrameSelection() {
    if (isCapturing) {
        console.log('[code.js] handleFrameSelection skipped: capture in progress');
        return;
    }
    
    const selection = figma.currentPage.selection;
    
    if (selection.length === 0) {
        const frames = findFrames(figma.currentPage);
        
        if (frames.length === 0) {
            figma.ui.postMessage({
                pluginMessage: { type: 'error', message: '当前页面没有找到 Frame。请在画布中选中一个 Frame，或者先创建 Frame。' }
            });
            return;
        } else if (frames.length === 1) {
            selectedFrame = frames[0];
            await captureAndSendImage(frames[0]);
            return;
        } else {
            // Multiple frames on page but none selected -> auto batch capture all
            selectedFrame = frames[0];
            figma.ui.postMessage({
                pluginMessage: {
                    type: 'multi-selection-detected',
                    data: { count: frames.length, frames: frames.map(f => ({ name: f.name, type: f.type, width: f.width, height: f.height })) }
                }
            });
            await captureAllSelectedFramesInternal(frames, capturedFrameNames);
            return;
        }
    }

    // Has selection -> check how many valid frames
    const validFrames = findValidFramesFromSelection(selection);

    if (validFrames.length > 1) {
        // Multi-select -> batch capture
        selectedFrame = validFrames[0];
        figma.ui.postMessage({
            pluginMessage: {
                type: 'multi-selection-detected',
                data: { count: validFrames.length, frames: validFrames.map(f => ({ name: f.name, type: f.type, width: f.width, height: f.height })) }
            }
        });
        await captureAllSelectedFramesInternal(validFrames, capturedFrameNames);
        return;
    }

    const frame = findSelectedFrame(selection);
    
    if (!frame) {
        let foundFrame = null;
        for (const item of selection) {
            foundFrame = item.parent;
            while (foundFrame && foundFrame.type !== 'PAGE') {
                if (foundFrame.type === 'FRAME' || foundFrame.type === 'COMPONENT' || foundFrame.type === 'INSTANCE') break;
                foundFrame = foundFrame.parent;
            }
            if (foundFrame && foundFrame.type !== 'PAGE') break;
            foundFrame = null;
        }
        
        if (!foundFrame) {
            figma.ui.postMessage({
                pluginMessage: { type: 'error', message: `选中的是 "${selection[0].name}" (${selection[0].type})，不是 Frame。请选中一个 Frame 或 Component。` }
            });
            return;
        }
        
        selectedFrame = foundFrame;
        await captureAndSendImage(foundFrame);
        return;
    }

    selectedFrame = frame;
    await captureAndSendImage(frame);
}

// Find frames recursively in a node
function findFrames(node) {
    let frames = [];
    if (node.type === 'FRAME') frames.push(node);
    if ('children' in node) {
        for (const child of node.children) {
            frames = frames.concat(findFrames(child));
        }
    }
    return frames;
}

// Find a valid frame from single selection
function findSelectedFrame(selection) {
    for (const item of selection) {
        const directTypes = ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'];
        if (directTypes.includes(item.type)) return item;
        
        let current = item.parent;
        let depth = 0;
        while (current && depth < 50 && current.type !== 'PAGE') {
            if (directTypes.includes(current.type)) return current;
            current = current.parent;
            depth++;
        }
        
        if (!current || current.type === 'PAGE') {
            const pageFrames = findFrames(figma.currentPage);
            if (pageFrames.length > 0) return pageFrames[0];
        }
    }
    return null;
}

// Find ALL valid frames from selection (for multi-select)
function findValidFramesFromSelection(selection) {
    const validFrames = [];
    const seenIds = new Set();
    
    for (const item of selection) {
        const directTypes = ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'];
        
        if (directTypes.includes(item.type)) {
            if (!seenIds.has(item.id)) {
                seenIds.add(item.id);
                validFrames.push(item);
            }
        } else {
            let current = item.parent;
            while (current && current.type !== 'PAGE') {
                if (directTypes.includes(current.type)) {
                    if (!seenIds.has(current.id)) {
                        seenIds.add(current.id);
                        validFrames.push(current);
                    }
                    break;
                }
                current = current.parent;
            }
        }
    }
    
    return validFrames;
}

// Capture a single frame as image and send to UI
async function captureAndSendImage(frame) {
    if (isCapturing) return;
    isCapturing = true;
    
    try {
        console.log('[code.js] === START captureAndSendImage ===');
        console.log('[code.js] frame:', frame.name, frame.type, `${frame.width}x${frame.height}`);

        const exportSettings = {
            format: 'PNG',
            constraint: { type: 'SCALE', value: 1 },
            contentsOnly: true,
        };

        const bytes = await frame.exportAsync(exportSettings);
        const base64 = arrayBufferToBase64(bytes);
        const dataUrl = `data:image/png;base64,${base64}`;

        const exportWidth = Math.round(frame.width);
        const exportHeight = Math.round(frame.height);

        figma.ui.postMessage({
            pluginMessage: {
                type: 'design-captured',
                data: {
                    imageDataUrl: dataUrl,
                    imageData: Array.from(bytes),
                    frameName: frame.name,
                    width: exportWidth,
                    height: exportHeight,
                    originalWidth: frame.width,
                    originalHeight: frame.height
                }
            }
        });

    } catch (error) {
        console.error('[code.js] ERROR in captureAndSendImage:', error);
        figma.ui.postMessage({
            pluginMessage: { type: 'error', message: `捕获图片失败: ${error.message}` }
        });
    } finally {
        isCapturing = false;
    }
}

// ============================================
// 批量捕获所有选中的 Frame（依次执行）
// ============================================

// Internal: batch capture with pre-resolved frame list
// existingNames: UI端已有的frameName列表，用于去重（只发送新增的）
async function captureAllSelectedFramesInternal(validFrames, existingNames) {
    if (isCapturing || !validFrames || validFrames.length === 0) return;

    // 过滤掉已存在的 Frame
    const newFrames = validFrames.filter(f => !existingNames.includes(f.name));
    if (newFrames.length === 0) {
        console.log('[code.js] all frames already captured, skipping');
        return;
    }

    isCapturing = true;

    // Notify start
    figma.ui.postMessage({ pluginMessage: { type: 'batch-capture-start', data: { count: newFrames.length, isNew: true } } });

    for (let i = 0; i < newFrames.length; i++) {
        const frame = newFrames[i];
        
        // Notify progress
        figma.ui.postMessage({
            pluginMessage: {
                type: 'batch-capture-progress',
                data: { current: i + 1, total: validFrames.length, frameName: frame.name }
            }
        });
        
        try {
            const exportSettings = {
                format: 'PNG',
                constraint: { type: 'SCALE', value: 1 },
                contentsOnly: true,
            };
            
            const bytes = await frame.exportAsync(exportSettings);
            const base64 = arrayBufferToBase64(bytes);
            const dataUrl = `data:image/png;base64,${base64}`;
            
            figma.ui.postMessage({
                pluginMessage: {
                    type: 'design-captured-batch',
                    data: {
                        imageDataUrl: dataUrl,
                        imageData: Array.from(bytes),
                        frameName: frame.name,
                        width: Math.round(frame.width),
                        height: Math.round(frame.height),
                        index: i + 1
                    }
                }
            });
            
            // Small delay between captures
            await new Promise(r => setTimeout(r, 100));
            
        } catch (error) {
            console.error(`[code.js] Error capturing "${frame.name}":`, error);
            figma.ui.postMessage({
                pluginMessage: {
                    type: 'batch-capture-error',
                    data: { frameName: frame.name, error: error.message }
                }
            });
        }
    }
    
    isCapturing = false;

    figma.ui.postMessage({
        pluginMessage: {
            type: 'batch-capture-complete',
            data: { count: newFrames.length }
        }
    });
}

// UI-triggered batch capture (re-reads current selection)
async function captureAllSelectedFrames() {
    if (isCapturing) return;
    
    const selection = figma.currentPage.selection;
    const validFrames = findValidFramesFromSelection(selection);
    
    if (validFrames.length === 0) {
        figma.ui.postMessage({
            pluginMessage: { type: 'error', message: '未找到可捕获的 Frame。请选中一个或多个 Frame / Component。' }
        });
        return;
    }
    
    isCapturing = true;
    
    // Notify start
    figma.ui.postMessage({ pluginMessage: { type: 'batch-capture-start', data: { count: validFrames.length } } });
    
    for (let i = 0; i < validFrames.length; i++) {
        const frame = validFrames[i];
        
        // Notify progress
        figma.ui.postMessage({
            pluginMessage: {
                type: 'batch-capture-progress',
                data: { current: i + 1, total: validFrames.length, frameName: frame.name }
            }
        });
        
        try {
            const exportSettings = {
                format: 'PNG',
                constraint: { type: 'SCALE', value: 1 },
                contentsOnly: true,
            };
            
            const bytes = await frame.exportAsync(exportSettings);
            const base64 = arrayBufferToBase64(bytes);
            const dataUrl = `data:image/png;base64,${base64}`;
            
            figma.ui.postMessage({
                pluginMessage: {
                    type: 'design-captured-batch',
                    data: {
                        imageDataUrl: dataUrl,
                        imageData: Array.from(bytes),
                        frameName: frame.name,
                        width: Math.round(frame.width),
                        height: Math.round(frame.height),
                        index: i + 1
                    }
                }
            });
            
            // Small delay between captures to avoid message stacking
            await new Promise(r => setTimeout(r, 100));
            
        } catch (error) {
            console.error(`[code.js] Error capturing "${frame.name}":`, error);
            figma.ui.postMessage({
                pluginMessage: {
                    type: 'batch-capture-error',
                    data: { frameName: frame.name, error: error.message }
                }
            });
        }
    }
    
    isCapturing = false;
    
    // Notify complete
    figma.ui.postMessage({
        pluginMessage: {
            type: 'batch-capture-complete',
            data: { count: validFrames.length }
        }
    });
}

// Convert ArrayBuffer to Base64 string
function arrayBufferToBase64(buffer) {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;

    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
    }

    return btoa(binary);
}
