<script setup lang="ts">
import { ref } from 'vue';
import sparkMd5 from 'spark-md5';

const CHUNK_SIZE = 1024 * 1024 * 1; // 1M
const fileHash = ref<string>('');
const fileName = ref<string>('');

const handleUpload = async (e: Event) => {
  const fileList = (e.target as HTMLInputElement).files
  if (!fileList) return
  fileName.value = fileList[0].name;
  const chunks = createFileChunks(fileList[0], CHUNK_SIZE);
  fileHash.value = await createFileHash(chunks);
  const data = await verify();
  if (!data.data.shouldUpload) {
    alert('文件已上传');
    return
  }
  uploadChunks(chunks, data.data.existChunks)
}

const createFileChunks = (file: File, chunkSize: number) => {
  const fileChunks: Blob[] = [];
  let cur = 0;
  while (cur < file.size) {
    fileChunks.push(file.slice(cur, cur + chunkSize));
    cur += chunkSize;
  }
  return fileChunks
}

const createFileHash = (chunks: Blob[]): Promise<string> => {
  return new Promise((resolve) => {
    const targets: Blob[] = [];
    const spark = new sparkMd5.ArrayBuffer();
    const fileReader = new FileReader();
    // 没有必要每个 chunk 都去参与计算, 计算量很大, 时间就会慢
    chunks.forEach((chunk, index) => {
      if (index === 0 || index === chunks.length - 1) {
        targets.push(chunk);
      } else {
        targets.push(chunk.slice(0, 2));
        targets.push(chunk.slice(CHUNK_SIZE / 2, CHUNK_SIZE / 2 + 2));
        targets.push(chunk.slice(CHUNK_SIZE - 2, CHUNK_SIZE))
      }
    })
    fileReader.readAsArrayBuffer(new Blob(targets));
    fileReader.onload = (e) => {
      spark.append(e.target?.result as ArrayBuffer);
      resolve(spark.end());
    }
  })
}

// 创建并发
const uploadChunks = async (chunks: Blob[], existChunks: string[] = [], max: number = 3) => {
  const data = chunks.map((chunk, index) => {

    return {
      fileHash: fileHash.value,
      chunkHash: `${index}-${fileHash.value}`,
      chunk: chunk
    }
  })
  const formData = data.filter(chunk => !existChunks.includes(chunk.chunkHash)).map(item => {
    const formData = new FormData();
    formData.append('fileHash', item.fileHash);
    formData.append('chunkHash', item.chunkHash);
    formData.append('chunk', item.chunk);
    return formData
  })
  let index = 0;
  const requestList: any[] = [];
  while (index < formData.length) {
    const task = fetch('http://127.0.0.1:3000/upload', {
      method: "POST",
      body: formData[index]
    })
    task.then(() => {
      requestList.splice(requestList.findIndex(item => item === task));
    })
    requestList.push(task);
    if (requestList.length === max) {
      await Promise.race(requestList);
    }
    index++;
  }
  try {
    await Promise.all(requestList);
    mergeRequest()
  } catch (error) {
    console.log('请求出错，请重试');
  }
}

// 通知服务器进行合并操作
const mergeRequest = () => {
  fetch('http://127.0.0.1:3000/merge', {
    method: "POST",
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      fileHash: fileHash.value,
      fileName: fileName.value,
      size: CHUNK_SIZE
    })
  }).then((response) => {
    return response.json()
  })
}

// 校验文件是否存在
const verify = async () => {
  return fetch('http://127.0.0.1:3000/verify', {
    method: "POST",
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      fileHash: fileHash.value,
      fileName: fileName.value
    })
  })
    .then(res => res.json())
    .then(res => {
      return res
    })
}
</script>

<template>
  <h1>大文件上传</h1>
  <input @change="handleUpload" type="file">
</template>

<style scoped></style>
