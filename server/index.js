const express = require('express');
const cors = require('cors');
const fse = require('fs-extra'); // fs 的增强版本
const path = require('path');
const multiparty = require('multiparty');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const UPLOAD_DIR = path.resolve(__dirname, 'upload');
const extractExt = fileName => {
    return fileName.substring(fileName.lastIndexOf('.') + 1)
}

app.post('/upload', (req, res) => {
    const form = new multiparty.Form();
    form.parse(req, async function (err, fields, files) {
        if (err) {
            res.status(401).json({ ok: false, message: '上次上传失败，请重新上传' })
            return
        }
        const fileHash = fields['fileHash'][0]
        const chunkHash = fields['chunkHash'][0]
        // 存放 chunk 文件块的<临时目录> 以文件的hash 名 作为文件名
        const chunkPath = path.resolve(UPLOAD_DIR, fileHash)
        if (!fse.existsSync(chunkPath)) { // 不存在就创建临时目录
            await fse.mkdir(chunkPath)
        }
        const oldPath = files['chunk'][0]['path']
        await fse.move(oldPath, path.resolve(chunkPath, chunkHash))

        res.status(200);
        res.send({ ok: true, message: '上传成功', data: null })
    });
})

app.post('/merge', async (req, res) => {
    const { fileHash, fileName, size } = req.body;
    const filePath = path.resolve(UPLOAD_DIR, `${fileHash}.${extractExt(fileName)}`);
    if (fse.existsSync(filePath)) {
        res.status(200);
        res.send({ ok: true, message: '合并成功', data: null })
        return
    }
    const chunkDir = path.resolve(UPLOAD_DIR, fileHash);
    if (!fse.existsSync(chunkDir)) {
        res.status(401);
        res.send({ ok: false, message: '合并失败，没有上传文件', data: null })
        return;
    }
    const chunksPaths = fse.readdirSync(chunkDir);
    chunksPaths.sort((a, b) => {
        return a.split('-')[0] - b.split('-')[0]
    })
    const promiselist = chunksPaths.map((chunkName, index) => {
        return new Promise(resolve => {
            const chunkPath = path.resolve(chunkDir, chunkName)
            const resdStream = fse.createReadStream(chunkPath);
            const writeStream = fse.createWriteStream(filePath, {
                start: index * size,
                end: (index + 1) * size
            });
            resdStream.on('end', async () => {
                await fse.unlink(chunkPath)
                resolve()
            })
            resdStream.pipe(writeStream);
        })
    })
    await Promise.all(promiselist);
    await fse.rmdir(chunkDir);
    res.status(200);
    res.send({ ok: true, message: '合并成功', data: null })
})

app.post('/verify', (req, res) => {
    const { fileHash, fileName } = req.body;
    const filePath = path.resolve(UPLOAD_DIR, `${fileHash}.${extractExt(fileName)}`);
    if (fse.existsSync(filePath)) {
        res.status(200);
        res.send({ ok: true, message: '文件已存在', data: { shouldUpload: false } })
        return;
    }
    // 检查是否有只上传了部分的文件，有的话把切片返回回去
    // 上传的部分是不会触发合并的
    const chunkDir = path.resolve(UPLOAD_DIR, fileHash);
    const chunksPaths = fse.existsSync(chunkDir) ? fse.readdirSync(chunkDir) : [];

    res.status(200);
    res.send({
        ok: true,
        message: '文件不存在',
        data: {
            shouldUpload: true,
            existChunks: chunksPaths
        }
    })
})

app.listen(3000, () => {
    console.log('server is running on port 3000');
})