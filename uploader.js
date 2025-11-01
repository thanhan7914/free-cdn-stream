import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import path from "path";
import { basenameNoExt } from "./util.js";
import appConfig from "./config.js";

async function createImage(fileUrl, fileName) {
  let data = JSON.stringify({
    web_uri: fileUrl,
    original_web_uri: fileUrl,
    name: fileName,
    show_error: false,
  });

  let config = {
    method: "post",
    maxBodyLength: Infinity,
    url: `https://business.tiktok.com/api/v3/bm/material/image/create/?org_id=${appConfig.tiktok.org_id}`,
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language":
        "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7,es-US;q=0.6,es;q=0.5,fr-FR;q=0.4,fr;q=0.3,mt;q=0.2",
      "cache-control": "no-cache",
      "content-type": "application/json",
      origin: "https://business.tiktok.com",
      pragma: "no-cache",
      priority: "u=1, i",
      referer: `https://business.tiktok.com/manage/material/image?org_id=${appConfig.tiktok.org_id}`,
      "sec-ch-ua":
        '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "trace-log-adv-id": "",
      "trace-log-user-id": "",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      "x-csrftoken": "38o6tIpLYKxAsDj6JFZK25w4FMNgtH8H",
      Cookie: appConfig.tiktok.cookie,
    },
    data: data,
  };

  const response = await axios.request(config);

  return response.data;
}

export async function uploadToTiktok(filePath) {
  let data = new FormData();
  data.append("Filedata", fs.createReadStream(filePath));

  let config = {
    method: "post",
    maxBodyLength: Infinity,
    url: `https://business.tiktok.com/api/v3/bm/material/image/upload/?org_id=${appConfig.tiktok.org_id}`,
    headers: {
      accept: "application/json, text/plain, */*",
      "accept-language":
        "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7,es-US;q=0.6,es;q=0.5,fr-FR;q=0.4,fr;q=0.3,mt;q=0.2",
      "cache-control": "no-cache",
      origin: "https://business.tiktok.com",
      pragma: "no-cache",
      priority: "u=1, i",
      referer: `https://business.tiktok.com/manage/material/image?org_id=${appConfig.tiktok.org_id}`,
      "sec-ch-ua":
        '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "trace-log-adv-id": "",
      "trace-log-user-id": "",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
      Cookie: appConfig.tiktok.cookie,
      ...data.getHeaders(),
    },
    data: data,
  };

  const response = await axios.request(config);
  const respData = response.data;
  const imgUrl = respData.data.image_info.web_uri;

  const name = basenameNoExt(filePath);
  await createImage(imgUrl, name);

  return imgUrl;
}
