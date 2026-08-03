# SymVizCrystal

SymViz 是一个面向晶体学与结构化学的交互式可视化工作台。它可以读取常用结构文件，显示晶胞、化学键与对称元素，并对空间群、点群、Wyckoff 位置、等价原子、无序和氢键进行检查。

当前版本：`v0.1.3`

## v0.1.3 主要功能

- 读取 CIF、SDF、MOL、XYZ、MOL2 与 PDB。
- 三维晶体结构、完整分子、超胞、坐标轴和后景 Z fade。
- 空间群操作、点群特征标表、Wyckoff 信息和等价位置映射。
- 无序字段、占有率一致性和 split-site 候选分析。
- 氢键候选、几何参数、约化晶胞、Madelung 静电能、粉末衍射和模型密度图。
- Gaussian 输入生成、本机任务队列和 `.log` / `.out` 结果解析。
- Gaussian Cube 读取以及正、负等值面的交互式三维显示。
- Electron 桌面模式，可自动检测 Gaussian 16 并直接提交任务，无需桥接器地址或访问令牌。
- Quantum ESPRESSO 周期模型输入生成、本机任务队列、实时输出和结果摘要。

## 本地启动

需要 Node.js `>=22.13.0`。

```powershell
npm install
npm run dev
```

构建与测试：

```powershell
npm run build
npm test
```

## 启动桌面版

如果电脑没有全局安装 Node.js / npm，直接双击项目根目录中的 `启动 SymViz 桌面版.cmd`即可。该启动器使用项目自带的 Electron，不需要 `npm`。`desktop/启动 SymViz.cmd` 也可以双击启动。

桌面版会先构建界面，然后打开独立的 SymVizCrystal 窗口：

```powershell
npm run desktop
```

开发模式：

```powershell
npm run desktop:dev
```

在桌面版中打开“量化 → 队列”，SymViz 会自动检测 `C:\G16W`。如果 Gaussian 安装在其他位置，点击“选择 Gaussian 文件夹”，选择包含 `g16.exe`、`formchk.exe` 和 `cubegen.exe` 的目录即可。随后可以直接点击“本机运行”。

桌面任务默认保存在“文档 → SymViz Gaussian Jobs”，重新打开 SymViz 后仍可看到历史任务。

## 桌面版使用 Quantum ESPRESSO

Quantum ESPRESSO 用于周期性晶体计算；Gaussian 仍用于孤立分子或分子簇计算。SymViz 不包含 Quantum ESPRESSO，也不会自动下载计算程序或赝势文件。

Windows 推荐通过 WSL2 Ubuntu 运行 Linux 版 Quantum ESPRESSO。在 Ubuntu 中安装：

```bash
sudo apt update
sudo apt install -y quantum-espresso quantum-espresso-data-sssp
```

重新启动 SymViz 后打开“量化 → 周期 DFT”，程序会自动检测 WSL 发行版、`/usr/bin/pw.x` 和系统 SSSP 赝势，不需要手动填写 Linux 路径。也可以覆盖选择：

- Quantum ESPRESSO 程序目录：包含 `pw.x` 或 `pw.exe` 的目录，也可以选择其上一级安装目录。
- 赝势目录：包含所需 `.UPF` 文件的目录。

首版支持 `SCF`、`relax` 和 `vc-relax`，由 CIF 的完整周期晶胞生成 `ibrav = 0` 输入，并提供 PBE、D3(BJ)、平面波截断能、k 点和占据方式设置。提交前会检查元素与赝势是否一一对应；含部分占有率或未解决无序的模型会被阻止直接计算。

任务默认保存在“文档 → SymViz Quantum ESPRESSO Jobs”。队列当前一次运行一个 `pw.x` 任务，并在 SymViz 中持续显示标准输出。WSL 模式会把所需 UPF 暂存到 Windows 任务目录；点击取消会先终止 Linux 进程组，再清理对应的 Windows `wsl.exe` 进程树。

Ubuntu 软件仓库中的 QE 6.7MaX 用于首轮 SCF 与结构优化联调。正式 Berry-phase 极化计算前应升级至当前稳定 QE 7.5，并重新完成赝势、截断能和 k 点收敛测试。

自发极化 `P_s` 将在后续小版本中基于 Berry phase 工作流加入。它需要同一赝势、截断能、k 点和晶胞约定下的极性态与中心对称参考态，不能由单个优化结构直接可靠给出。

## 网页版连接本机 Gaussian 16

SymViz 不包含 Gaussian，也不会绕过 Gaussian 的安装或许可。用户需要在本机安装并获授权使用 Gaussian 16。

默认安装目录为 `C:\G16W`。如安装在其他位置，可先设置：

```powershell
$env:SYMVIZ_GAUSSIAN_ROOT="D:\Gaussian\G16W"
```

随后在项目目录运行：

```powershell
npm run gaussian:bridge
```

保持该终端开启，并把终端显示的访问令牌粘贴到 SymViz 的“量化 → 队列”面板。桥接器只监听 `127.0.0.1`，计算输入、输出、检查点和 Cube 文件保存在本机；默认不会上传到 SymViz 网站或第三方服务器。

可选环境变量：

- `SYMVIZ_GAUSSIAN_ROOT`：Gaussian 16 安装目录。
- `SYMVIZ_GAUSSIAN_WORKDIR`：本地任务目录。
- `SYMVIZ_GAUSSIAN_PORT`：桥接端口，默认为 `8765`。
- `SYMVIZ_GAUSSIAN_TOKEN`：固定本地令牌；未设置时每次启动随机生成。

## 访问方式

SymViz 的公共网页不要求登录。GitHub 仓库是否公开与网站是否需要登录相互独立；当前仓库可以保持私有。

## 后续路线

- `v0.1.4`：Hirshfeld surface 与二维 fingerprint。
- `v0.1.5`：晶体分子间相互作用能与 energy framework。
