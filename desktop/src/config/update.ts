// 从公开 GitHub Release 查询最新版本，不上传用户档案数据。
export const UPDATE_FEED_URL = "https://api.github.com/repos/evonotevil/Charter/releases/latest";
/** 官网部署时从 GitHub 最新正式 Release 自动生成，供 API 限流或不可达时备用。 */
export const UPDATE_FALLBACK_URL = "https://evonotevil.github.io/Charter/update.json";
/** 打开当前最新正式版本的发布页，供用户选择对应平台安装包。 */
export const DOWNLOAD_PAGE_URL = "https://github.com/evonotevil/Charter/releases/latest";
