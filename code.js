// ============================================
// UI-REL Design Review Plugin - Main Plugin Code
// ============================================
// This runs in the Figma sandbox and handles:
// - Frame selection
// - Image capture/export
// - Communication with UI

let selectedFrame = null;
let isCapturing = false; // 防抖：防止重复触发导出

// Listen for messages from UI
figma.showUI(__html__, { width: 1000, height: 800 });

figma.ui.onmessage = async (msg) => {
    switch (msg.type) {
        case 'select-frame':
            await handleFrameSelection();
            break;
        case 'reset':
            selectedFrame = null;
            isCapturing = false;
            figma.currentPage.selection = [];
            break;
        case 'request-current-selection':
            const sel = figma.currentPage.selection;
            if (sel.length > 0) {
                handleFrameSelection();
            }
            break;
        default:
            console.log('Unknown message type:', msg.type);
    }
};

// Listen for selection changes - auto-detect frame
figma.on('selectionchange', () => {
    const selection = figma.currentPage.selection;
    console.log('[code.js] selectionchange triggered, count:', selection.length);
    
    if (selection.length > 0) {
        // Try to find a valid frame from current selection
        const frame = findSelectedFrame(selection);
        if (frame) {
            selectedFrame = frame;
            
            // 防抖：如果正在导出中则跳过
            if (!isCapturing) {
                captureAndSendImage(frame);
            } else {
                console.log('[code.js] skipping - capture already in progress');
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

// Handle frame selection
async function handleFrameSelection() {
    const selection = figma.currentPage.selection;
    
    // Check if user has something selected
    if (selection.length === 0) {
        // Try to find frames in the current page
        const frames = findFrames(figma.currentPage);
        
        if (frames.length === 0) {
            figma.ui.postMessage({
                pluginMessage: {
                    type: 'error',
                    message: '当前页面没有找到 Frame。请在画布中选中一个 Frame，或者先创建 Frame。'
                }
            });
            return;
        } else if (frames.length === 1) {
            // Auto-select the only frame
            selectedFrame = frames[0];
            await captureAndSendImage(frames[0]);
            return;
        } else {
            // Auto-select and capture the first visible frame
            selectedFrame = frames[0];
            figma.currentPage.selection = [frames[0]];
            figma.viewport.scrollAndZoomIntoView([frames[0]]);
            await captureAndSendImage(frames[0]);
            return;
        }
    }

    // User has selection - find a valid frame
    const frame = findSelectedFrame(selection);
    
    if (!frame) {
        // Try harder - check if selection is inside a frame
        let foundFrame = null;
        for (const item of selection) {
            foundFrame = item.parent;
            while (foundFrame && foundFrame.type !== 'PAGE') {
                if (foundFrame.type === 'FRAME' || foundFrame.type === 'COMPONENT' || foundFrame.type === 'INSTANCE') {
                    break;
                }
                foundFrame = foundFrame.parent;
            }
            if (foundFrame && foundFrame.type !== 'PAGE') break;
            foundFrame = null;
        }
        
        if (!foundFrame) {
            figma.ui.postMessage({
                pluginMessage: {
                    type: 'error',
                    message: `选中的是 "${selection[0].name}" (${selection[0].type})，不是 Frame。请选中一个 Frame 或 Component。`
                }
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

    if (node.type === 'FRAME') {
        frames.push(node);
    }

    if ('children' in node) {
        for (const child of node.children) {
            frames = frames.concat(findFrames(child));
        }
    }

    return frames;
}

// Find a valid frame from selection (check selection or parents)
function findSelectedFrame(selection) {
    for (const item of selection) {
        console.log('[code.js] checking item:', item.name, 'type:', item.type);
        
        // Direct match
        const directTypes = ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'];
        if (directTypes.includes(item.type)) {
            console.log('[code.js] -> direct match');
            return item;
        }
        
        // Walk up the parent chain to find a frame-like ancestor
        let current = item.parent;
        let depth = 0;
        while (current && depth < 50 && current.type !== 'PAGE') {
            if (directTypes.includes(current.type)) {
                console.log('[code.js] -> found parent frame:', current.name, 'type:', current.type);
                return current;
            }
            current = current.parent;
            depth++;
        }
        
        // If we reached PAGE without finding anything, check if PAGE has children that are frames
        // This handles the case where user selected something inside a top-level frame
        if (!current || current.type === 'PAGE') {
            // Try to find any frame on the page as fallback
            const pageFrames = findFrames(figma.currentPage);
            if (pageFrames.length > 0) {
                // Return the first frame found on the page
                return pageFrames[0];
            }
        }
    }

    return null;
}

// Capture frame as image and send to UI
async function captureAndSendImage(frame) {
    if (isCapturing) return;
    isCapturing = true;
    
    try {
        console.log('[code.js] === START captureAndSendImage ===');
        console.log('[code.js] frame:', frame.name, frame.type, `${frame.width}x${frame.height}`);

        // Export settings - use PNG for highest quality
        const exportSettings = {
            format: 'PNG',
            constraint: { type: 'SCALE', value: 1 },
            contentsOnly: true,
        };

        console.log('[code.js] calling exportAsync...');
        const bytes = await frame.exportAsync(exportSettings);
        console.log('[code.js] exportAsync done, bytes length:', bytes.length);

        // Convert to data URL
        console.log('[code.js] converting to base64...');
        const base64 = arrayBufferToBase64(bytes);
        const dataUrl = `data:image/png;base64,${base64}`;
        console.log('[code.js] base64 done, length:', base64.length);

        const exportWidth = Math.round(frame.width);
        const exportHeight = Math.round(frame.height);

        console.log('[code.js] sending design-captured message to UI...');
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
        console.log('[code.js] === END captureAndSendImage (success) ===');

    } catch (error) {
        console.error('[code.js] ERROR in captureAndSendImage:', error);
        figma.ui.postMessage({
            pluginMessage: {
                type: 'error',
                message: `捕获图片失败: ${error.message}`
            }
        });
    } finally {
        isCapturing = false;
    }
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
