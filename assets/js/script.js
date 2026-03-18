// 全局 Upscaler 实例（懒加载一次即可复用）
let upscalerInstance = null;

/**
 * 懒加载 Upscaler 模型
 */
async function loadUpscaler() {
    if (upscalerInstance) {
        console.log('[Upscaler] 已有实例，复用');
        return upscalerInstance;
    }

    console.log('[Upscaler] 开始加载模型...');
    const model = DefaultUpscalerJSModel; // 来自 @upscalerjs/default-model 的 2x ESRGAN 模型
    upscalerInstance = new Upscaler({ model });
    console.log('[Upscaler] 模型加载完成');
    return upscalerInstance;
}

/**
 * 在指定 canvas 上执行老照片修复
 * @param {HTMLCanvasElement} canvas - 输出用的 Canvas
 * @param {string} imageUrl - dataURL / blob URL
 */
async function restoreOldPhotoOnCanvas(canvas, imageUrl) {
    console.log('[RESTORE] 开始修复流程，imageUrl 长度 =', imageUrl.length);

    const upscaler = await loadUpscaler();

    // 1. 使用 UpscalerJS 做 2x 超分 + 基础增强
    console.log('[RESTORE] 调用 Upscaler.upscale...');
    const resultTensor = await upscaler.upscale(imageUrl, {
        output: 'tensor',
        scale: 2,       // 2 倍放大，一般对老照片足够；想更锐可以尝试 3
        patchSize: 64,  // 分块大小，避免大图一次性吃满显存
        padding: 5
    });
    console.log('[RESTORE] Upscaler 输出 tensor 形状:', resultTensor.shape);

    // 2. 归一化到 [0, 1]，才能安全传给 tf.browser.toPixels
    const normalizedTensor = resultTensor.div(255).clipByValue(0, 1);

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    console.log('[RESTORE] 开始写回 Canvas...');
    await tf.browser.toPixels(normalizedTensor, canvas);

    // 3. 在 Canvas 像素上做二次“视觉优化”：提亮 + 提一点对比度
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;

    // 你可以微调这两个参数，来平衡“通透感”和“不过曝”
    const brightness = 8;     // +8 左右即可，太大会发白
    const contrast = 1.10;    // 1.05 ~ 1.15 之间慢慢试

    for (let i = 0; i < data.length; i += 4) {
        // R / G / B 三个通道分别处理
        for (let c = 0; c < 3; c++) {
            let v = data[i + c];                   // 0 ~ 255
            v = (v - 128) * contrast + 128 + brightness;
            if (v > 255) v = 255;
            if (v < 0) v = 0;
            data[i + c] = v;
        }
        // data[i + 3] 是 alpha 不动
    }
    ctx.putImageData(imageData, 0, 0);

    // 4. 释放 tensor，避免内存泄漏
    tf.dispose(resultTensor);
    tf.dispose(normalizedTensor);

    console.log('[RESTORE] 修复流程完成 ✅');
}

// ============ 页面 DOM 事件绑定（所有页面通用） ============

const fileInput = document.getElementById('file-input');
const outputCanvas = document.getElementById('outputCanvas');
const restoreBtn = document.getElementById('restoreBtn');

if (fileInput && outputCanvas && restoreBtn) {
    // 选择图片后，预览到 Canvas
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        console.log('[UPLOAD] 选择的文件:', file.name, file.type, file.size, 'bytes');

        const reader = new FileReader();
        reader.onload = (event) => {
            fileInput.fileUrl = event.target.result; // 存一个 dataURL，后面修复用

            const img = new Image();
            img.onload = () => {
                const maxWidth = 800;   // 控制展示宽度
                let drawWidth = img.width;
                let drawHeight = img.height;

                if (drawWidth > maxWidth) {
                    drawHeight = maxWidth * (img.height / img.width);
                    drawWidth = maxWidth;
                }

                outputCanvas.width = drawWidth;
                outputCanvas.height = drawHeight;

                const ctx = outputCanvas.getContext('2d');
                ctx.clearRect(0, 0, drawWidth, drawHeight);
                ctx.drawImage(img, 0, 0, drawWidth, drawHeight);

                console.log('[UPLOAD] 预览绘制完成，尺寸:', drawWidth, 'x', drawHeight);
            };
            img.src = fileInput.fileUrl;
        };
        reader.readAsDataURL(file);
    });

    // 点击“Restore Photo”时执行修复
    restoreBtn.addEventListener('click', async () => {
        if (!fileInput.fileUrl) {
            alert('Please upload an image first.');
            return;
        }

        console.log('[UI] 用户点击 Restore Photo');
        // UI 提示：修复中
        const oldText = restoreBtn.textContent;
        restoreBtn.textContent = 'Restoring...';
        restoreBtn.disabled = true;

        try {
            await restoreOldPhotoOnCanvas(outputCanvas, fileInput.fileUrl);
            console.log('[UI] Restore 完成事件触发');
            // 这里再给一个明显提示：按钮文字改一下
            restoreBtn.textContent = 'Restored ✔';
        } catch (err) {
            console.error('[RESTORE] 出错:', err);
            alert('Restoration failed. Please check the console for details.');
            restoreBtn.textContent = oldText;
        } finally {
            // 短暂停留后恢复按钮文字
            setTimeout(() => {
                restoreBtn.textContent = oldText;
                restoreBtn.disabled = false;
            }, 1500);
        }
    });
} else {
    console.warn('[INIT] 没有找到 file-input / outputCanvas / restoreBtn 元素，请检查页面 HTML id 是否匹配');
}