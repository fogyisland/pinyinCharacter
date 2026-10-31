# 服务器调优清单：TCP 拥塞控制与缓冲区（BBR）

> 这是一份**操作手册**，不是脚本。仓库里只放**配置 + 说明**；**是否执行、何时执行由有服务器权限的人决定**。
> 下面每一步都有三样东西：**可复制的命令**、**期望输出**、**失败时怎么办**。
> 照着做的人不需要读过这个仓库，也不需要了解这个站点。

---

## 0. 这次要改的是什么

| 项 | 值 |
| --- | --- |
| 改的对象 | 服务器**内核**的 TCP 拥塞控制 + TCP 收发缓冲区 |
| 配置文件 | `deploy/tuning/ipv4-bbr.conf`（**恰好 7 个** sysctl 键） |
| 装到服务器的路径 | `/etc/sysctl.d/99-ziyun-bbr.conf` |
| 目标链路 | 中国联通 → 新加坡，实测 **RTT 250 ms** |
| 改动前的实测 | 单连接持续吞吐 **177 KB/s** |
| 内核前提 | **≥ 4.9**（`tcp_bbr` 与 `sch_fq` 都从 4.9 起可用） |
| 影响面 | 只影响 **TCP**（HTTP/1.1 + HTTP/2）。**HTTP/3 不在影响面内** —— 见 §7 |

⚠️ **BBR 只对新建的 TCP 连接生效**，改动瞬间已经在跑的连接仍然用旧算法，直到它们断开重连。

⚠️ 本手册里的每条命令**都要在你自己的服务器上执行**。本文档不记录任何一次执行的结论 —— 现状值、收益数字都由**执行者**当场测、当场记。

---

## 1. 改前先看现状（这一步的输出必须原样抄下来）

**这一步是整套流程里唯一不能省的一步。** 回滚时要靠它：内核里的值改了以后，配置文件里不会记着原来的值，只有你自己抄下来的这份「现状表」知道。

### 1.1 记下七个键的现值

```bash
sysctl net.ipv4.tcp_congestion_control
sysctl net.core.default_qdisc
sysctl net.ipv4.tcp_max_syn_backlog
sysctl net.ipv4.tcp_rmem
sysctl net.ipv4.tcp_wmem
sysctl net.core.rmem_max
sysctl net.core.wmem_max
```

**期望输出**（**典型**默认值 —— **你的机器不一定一样**；`net.core.default_qdisc` 要特别当心，见下面那条提醒）：

```
net.ipv4.tcp_congestion_control = cubic
net.core.default_qdisc = pfifo_fast
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.tcp_rmem = 4096 131072 6291456
net.ipv4.tcp_wmem = 4096 16384 4194304
net.core.rmem_max = 212992
net.core.wmem_max = 212992
```

> ⚠️ 上面这七行是**参考值，不是「应该长这样」**。以你机器上实际打印出来的为准 —— 下一步会把它整份存下来。
>
> ⚠️ **`net.core.default_qdisc` 尤其不许照抄。** 内核自带的默认值是 `pfifo_fast`，但**发行版随包的 sysctl 片段会把它换成别的值**（Ubuntu 20.10 起通常是 `fq_codel`）⇒ **它很可能根本不是 `pfifo_fast`**。§5 回滚时**用你在 §1.1 记下的那个值**把这一项写回去，不要照抄上面这份参考值。

**把七行原样记进一个文件**（回滚要用）：

```bash
sudo sysctl -a > ~/sysctl-before-bbr.txt
```

**期望输出**：命令本身**没有任何输出**（内容进了文件）。

**验证一下存下来了**：

```bash
grep -E 'net\.(ipv4\.tcp_(congestion_control|max_syn_backlog|rmem|wmem)|core\.(default_qdisc|rmem_max|wmem_max))' ~/sysctl-before-bbr.txt
```

**期望输出**：能看到上面那七个键，各一行。

**失败时怎么办**：

| 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| `sysctl: cannot stat /proc/sys/...` | 这个内核没有该键 | 记下来，继续；装配置时它会报「no such key」，属正常 |
| `sysctl: permission denied on key ...` | 少了 `sudo` | 用 `sudo sysctl -a` 重跑 |
| `~/sysctl-before-bbr.txt` 是空的 | 重定向失败 | 换 `sudo sh -c 'sysctl -a > ~/sysctl-before-bbr.txt'` 再试 |

### 1.2 顺手把「改前」的速度基线也测下来

**这一步是必做的，不是可选的。** 只有改前的数字，才能判断这次改动是不是白做（§6）。

⚠️ **必须从中国侧的客户端测**。写这份手册的人所在机房到这台服务器的 RTT **小于 1 ms**（同一个机房），**跟真实用户走的 RTT 250 ms 跨境链路不是同一条路径** —— 在这里测出来的数字**不能代表**跨境链路的容量，**不要拿它当基线**。

先挑一个**足够大的**静态文件（建议 ≥ 2 MB），并确认它真的能下载：

```bash
curl -sI https://ziyun.pudafo.com/fonts/LXGWWenKaiGB-Regular.woff2 | head -5
```

**期望输出**：`HTTP/2 200`，并且有 `content-length:` 一行且数值不小（MB 级）。

> 若这个文件不存在（返回 404），换一个同样在 `/fonts/` 或 `/font/` 下、返回 200 且体积够大的文件即可；**改前改后必须是同一个文件**，否则两个数字没法比。

然后测速度（**改配置之前**跑）：

```bash
curl -o /dev/null -s -w 'speed=%{speed_download} B/s time=%{time_total}\n' \
     https://ziyun.pudafo.com/fonts/LXGWWenKaiGB-Regular.woff2
```

**期望输出**：一行 `speed=<数字> B/s time=<数字>`。

**把这个数字抄下来**（记成 `改前 = ? B/s`）。它就是基线。

**失败时怎么办**：

| 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| `speed=0 B/s` 或 `time_total` 很大 | 文件没取到 / 被重定向 | 先用 `curl -sI` 确认 200，再重跑 |
| 测出来快得离谱（比如几十 MB/s） | 你**不在中国侧**，量到的是同机房链路 | 换一台中国侧的机器重测 |
| 输出里没有 `speed=` | 少了 `-w` 参数 | 检查命令里 `-w` 后面有引号 |

---

## 2. 把配置文件送到服务器上

⚠️ **`deploy/tuning/ipv4-bbr.conf` 是仓库里的一个路径**。服务器上**通常没有仓库检出** ⇒ 直接照抄 `cp deploy/tuning/...` 会得到一句看不出真实原因的 `No such file or directory`。下面两条路**二选一**。

### 2.1 路线 A：服务器上有仓库检出（少见）

在**仓库根目录**下执行：

```bash
sudo cp deploy/tuning/ipv4-bbr.conf /etc/sysctl.d/99-ziyun-bbr.conf
```

**期望输出**：**没有任何输出**。

**验证**：

```bash
sudo ls -l /etc/sysctl.d/99-ziyun-bbr.conf && sudo cat /etc/sysctl.d/99-ziyun-bbr.conf
```

**期望输出**：一行 `ls` 的信息 + 文件的 7 行键值（前面带注释）。

**失败时怎么办**：

| 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| `cp: cannot stat 'deploy/tuning/ipv4-bbr.conf'` | 当前目录不是仓库根目录 | `cd` 到仓库根目录再跑；或改走路线 B |
| `cp: Permission denied` | 目标目录要 root | 命令里已经有 `sudo` 时不会发生；若仍报错说明 sudo 没生效，检查 sudoers |

### 2.2 路线 B：本地机器推过去（常见）

**在本地（你自己的电脑）执行**，把文件送到服务器的 `/tmp/`：

```bash
scp deploy/tuning/ipv4-bbr.conf user@host:/tmp/ipv4-bbr.conf
```

**期望输出**：没有输出即表示成功（`scp` 成功时不打印任何东西）。

**再回到服务器上**，装到 `/etc/sysctl.d/`：

```bash
sudo cp /tmp/ipv4-bbr.conf /etc/sysctl.d/99-ziyun-bbr.conf
```

**期望输出**：没有任何输出。

**核对文件内容没在传输中损坏**（本地和服务器各算一次 md5，两边必须一样）：

```bash
# 服务器上
md5sum /etc/sysctl.d/99-ziyun-bbr.conf
# 本地
md5sum deploy/tuning/ipv4-bbr.conf
```

**期望输出**：两边的 md5 完全相同。

**失败时怎么办**：

| 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| `scp: No such file or directory`（本地） | 本地当前目录不是仓库根目录 | `cd` 到仓库根目录，确认 `ls deploy/tuning/ipv4-bbr.conf` 能打印出文件，再重跑 |
| `scp: Permission denied` | 没有该服务器上的账号/密钥 | 换有权限的账号，或先 `ssh` 上去确认能登录 |
| `ssh: connect to host ... port 22: Connection timed out` | 安全组 / 防火墙没放行 22 | 走服务器控制台（VNC/网页终端），或联系有网络权限的人 |
| 没有 `scp`（Windows 老版本） | 客户端缺 OpenSSH | 用 `ssh` + 重定向代替：`cat deploy/tuning/ipv4-bbr.conf \| ssh user@host 'cat > /tmp/ipv4-bbr.conf'` |
| 两边 md5 不一样 | 传输被截断或改写 | 重传一次；仍不一样就不要往下走，先查清楚 |

---

## 3. 应用：先加载模块，再写配置

**顺序不能反**：模块没加载，`sysctl --system` 就会把 `net.core.default_qdisc = fq` 写不进去，而 `fq` 是 BBR 的**打流前提** —— 只有 BBR 没有 fq，收益会打折。

**每一条命令都要单独看退出码**：`modprobe` 静默失败时，`sysctl --system` 也会返回非零，但那时候你分不清是「模块没加载」还是「别的键写不进去」 ⇒ 每一步都单独 `echo "exit=$?"` 才知道断在哪。

```bash
sudo modprobe tcp_bbr; echo "exit=$?"
sudo modprobe sch_fq;  echo "exit=$?"
sudo sysctl --system; echo "exit=$?"
```

**期望输出**：

- 第一条：`exit=0`（**必须**是 0）
- 第二条：`exit=0`（**必须**是 0 —— `sch_fq` 加载不了 ⇒ `fq` 设不上 ⇒ BBR 等于没开）
- 第三条：`exit=0`（**必须**是 0）

`sysctl --system` 正常时会打印一长串 `net.core.default_qdisc = fq` 之类的回显，**最后那个 `exit=` 才是判据**。

**失败时怎么办**：

| 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| `sudo modprobe sch_fq` → `exit=1`，报 `modprobe: FATAL: Module sch_fq not found` | 内核太老（`sch_fq` 需要 **≥ 4.9**） | 走下面的「**内核太老怎么办**」 |
| `sudo modprobe tcp_bbr` → `exit=1`，报 `Module tcp_bbr not found` | 内核太老（`tcp_bbr` 需要 **≥ 4.9**） | 同上 |
| `sysctl --system` → `exit≠0`，并打印 `sysctl: error setting key 'net.core.default_qdisc' ... No such file or directory` | **`sch_fq` 没加载**（最常见） | 先 `sudo modprobe sch_fq; echo "exit=$?"`，确认 0 之后**重跑** `sudo sysctl --system; echo "exit=$?"` |
| `sysctl --system` → `exit≠0`，报别的键 | 该键内核不支持 | 看那一行 `error setting key` 指的是哪个键；记下来，它多半来自本机 `/etc/sysctl.conf` 或 `/etc/sysctl.d/` 下的**别的**文件（`--system` 会把目录下所有文件都读一遍） |
| `sysctl --system` → `exit≠0`，但没有任何 `error setting` 行 | 有别的文件写了非法值 | 用 `sudo sysctl --system 2>&1 \| grep -i error` 再看一遍 |

> ⚠️ **`exit≠0` 时不要当成功。** 只要有任何一行设不上，这次就**不是**全部写进去了。

**内核太老怎么办（内核 < 4.9）**

`tcp_bbr` / `sch_fq` 都加载不了 ⇒ 内核版本低于 4.9。此时**只应用 qdisc 与缓冲区那几行**，也就是把 `ipv4-bbr.conf` 里的 `net.ipv4.tcp_congestion_control = bbr` 这一行注释掉再装：

```bash
sudo sed -i 's/^net\.ipv4\.tcp_congestion_control = bbr$/#&/' /etc/sysctl.d/99-ziyun-bbr.conf
sudo sysctl --system; echo "exit=$?"
```

若 `net.core.default_qdisc = fq` 这一行也报 `No such file or directory`（`sch_fq` 同样不可用），把**它**也注释掉：

```bash
sudo sed -i 's/^net\.core\.default_qdisc = fq$/#&/' /etc/sysctl.d/99-ziyun-bbr.conf
sudo sysctl --system; echo "exit=$?"
```

**期望输出**：这次 `exit=0`，缓冲区那几行被写进去了。

⚠️ **这种情况下 BBR 未完全生效**：拥塞控制仍然是内核默认的 `cubic`，本次只调了 TCP 缓冲区。**记下这一点**，别在别处宣称这台机器用上了 BBR。

---

## 4. 确认是否生效（要查两项，不止一项）

```bash
sysctl net.ipv4.tcp_congestion_control     # 期望 bbr
sysctl net.core.default_qdisc              # 期望 fq   ← 这一项最容易被漏掉
ss -tin | grep -i bbr                      # 新连接应显示 bbr
```

**期望输出**：

```
net.ipv4.tcp_congestion_control = bbr
net.core.default_qdisc = fq
```

第三条会打印当前活动 TCP 连接的拥塞算法，形如：

```
ESTAB  0  0  10.0.0.2:443  1.2.3.4:52000  cubic wscale:7,7 rto:204 rtt:250/120 bbr
```

**失败时怎么办**：

| 现象 | 原因 | 怎么办 |
| --- | --- | --- |
| 第一条打印 `cubic`（不是 `bbr`） | `tcp_bbr` 没加载，或 `sysctl --system` 那一轮失败 | `sudo modprobe tcp_bbr && sudo sysctl -w net.ipv4.tcp_congestion_control=bbr; echo "exit=$?"`；`bbr` 不在可选值里就说明内核太老 ⇒ 走 §3 的「内核太老怎么办」 |
| 第二条打印 `pfifo_fast`（不是 `fq`） | `sch_fq` 没加载 | `sudo modprobe sch_fq; echo "exit=$?"`，然后 `sudo sysctl -w net.core.default_qdisc=fq; echo "exit=$?"` |
| 第三条**没有输出** | 当前没有活动的 TCP 连接（`ss` 看的是**已建立**的连接） | 从浏览器访问一次站点，再跑一次 `ss -tin \| grep -i bbr`；**注意 BBR 只对新建连接生效**，改动前就存在的连接仍显示旧算法 |
| 三条都正常 | —— | 机制层面的确认通过了。**但这不代表带宽变大了** —— 收益要自己量，见 §6 |

**顺带确认内核版本**（万一以后要查为什么 BBR 没上线）：

```bash
uname -r
```

**期望输出**：形如 `5.15.0-xx-generic`。低于 `4.9` 的内核不具备 BBR。

---

## 5. 回滚：三步走，顺序不能反

⚠️ **回滚不是「删文件 + `sysctl --system`」。**

`sysctl --system` 的语义是：**只把配置文件里的值写进内核**。它**从不会**把某个 key 恢复成改之前的样子。删掉配置文件之后，**内核里仍然是 `fq` + `bbr` + 放大后的缓冲区，直到重启才复原** —— 也就是说，**文件删了 ≠ 退掉了**。

**顺序有讲究：先写回原值，再删文件。** 反过来的话，删完文件但还没写回原值的那段时间里，配置仍然生效；而**下一次任何一次 `sysctl --system`**（别的运维脚本、别的维护动作、或重启前的 systemd 动作）都会把旧配置重新写回来。

### 步骤 1：按 §1.1 记下的原值逐项写回去

```bash
# 下面这组是**参考值**,**以你自己在「改前先看现状」里记下的那份为准**,别照抄。
# ⚠️ `net.core.default_qdisc` 尤其别照抄:内核自带默认是 pfifo_fast,
#    但发行版随包 sysctl 常给别的值(Ubuntu 20.10 起通常是 fq_codel),
#    照抄 pfifo_fast 会把机器改成一个它启动时并不存在的状态。
#    ⇒ 这一条**故意没给命令**:从 §1.1 **存进 `~/sysctl-before-bbr.txt` 的那一份**里 `default_qdisc` 那一行取等号后面的值,
#      自己写成 `sudo sysctl -w net.core.default_qdisc=<把这里换成 §1.1 记下的那个值>`。
sudo sysctl -w net.ipv4.tcp_congestion_control=cubic
sudo sysctl -w net.ipv4.tcp_max_syn_backlog=4096
sudo sysctl -w net.ipv4.tcp_rmem="4096 131072 6291456"
sudo sysctl -w net.ipv4.tcp_wmem="4096 16384 4194304"
sudo sysctl -w net.core.rmem_max=212992
sudo sysctl -w net.core.wmem_max=212992
```

**期望输出**：每条打印一行 `net.xxx = <写进去的值>`，**没有** `error` 字样。

**失败时怎么办**：某条报 `sysctl: permission denied` ⇒ 忘了 `sudo`；报 `error setting key` ⇒ 这个键你机器上名字不同/不存在，跳过它并在 §5 步骤 3 的复核里确认它没被改动；报 `syntax error` ⇒ 上面 `default_qdisc` 那条的占位符没替换干净，把尖括号里那句说明整个换成 §1.1 记下的实际值再执行。

### 步骤 2：再删掉配置文件

```bash
sudo rm -f /etc/sysctl.d/99-ziyun-bbr.conf
```

**期望输出**：没有任何输出。

> 不删的后果：文件还在 ⇒ **任何一次 `sysctl --system`（或重启）都会把 BBR 那套值重新写回来**，等于白退。

### 步骤 3：复核

```bash
sysctl net.ipv4.tcp_congestion_control     # 期望 cubic
sysctl net.core.default_qdisc              # 期望 §1.1 里记下的那一行(不一定是 pfifo_fast)
```

**期望输出**：

```
net.ipv4.tcp_congestion_control = cubic
net.core.default_qdisc = <你在 §1.1 记下的那个值>
```

> ⚠️ `default_qdisc` 这一行**要和 §1.1 记下的那一行逐字相同**才算退干净。它**可能是 `pfifo_fast`，也可能是 `fq_codel` 或 `fq`** ⇒ 你机器上原来是什么，滚回去就还是什么。**看到 `fq_codel` 而不是 `pfifo_fast`，不代表回滚失败** —— 那多半就是它原来的值；反过来，**看到 `fq` 而 §1.1 记的不是 `fq`，那就是没退干净**，按 §1.1 的值再写一次。

**失败时怎么办**：还有别的键不对 ⇒ 回步骤 1，把 §1.1 那份「现状表」里**七个键全部**逐项 `sysctl -w` 回去（其中 `net.core.default_qdisc` 那一项按步骤 1 的说明**自己写**，用 §1.1 记下的值），再复核一遍。

> 复核完可以把 `~/sysctl-before-bbr.txt` 留着，别删 —— 下次再改的时候它就是现成的基线。

---

## 6. 收益要自己量（必做）

§4 那几条只验证了「**机制生效了**」（`ss` 里出现 `bbr`），**没有验证「带宽变大了**」。

BBR 的宣传语是「通常能翻数倍」，但**这条链路的实际容量有没有被打满，写这份手册的人无法复现**（所在机房到这台服务器 RTT < 1 ms，与 RTT 250 ms 的中国联通 → 新加坡链路**不是同一条路径**）⇒ **收益必须由中国侧的客户端来量**。

```bash
# 改前、改后各跑一次,取同一个大文件,比较 speed_download
curl -o /dev/null -s -w 'speed=%{speed_download} B/s time=%{time_total}\n' \
     https://ziyun.pudafo.com/fonts/LXGWWenKaiGB-Regular.woff2
```

**期望输出**：一行 `speed=<数字> B/s time=<数字>`。

- **改前**的那个数字在 §1.2 已经测过了；
- **改后**在 §4 确认机制生效之后再跑一次；
- **两次都记下来**（例如 `改前 = 177 KB/s`、`改后 = ? KB/s`）。

**失败时怎么办 / 怎么读这两个数字**：

| 现象 | 怎么理解 |
| --- | --- |
| 改后明显更大 | 这次改动有收益（**但记得测多次取中位数**，单次测量会被链路抖动带偏） |
| 改后和改前差不多 | **不一定是失败** —— 见 §9：如果这条链路的实际容量本来就只有 ~1.4 Mbps，那么 177 KB/s 已经跑满，**BBR 一分钱也省不出来**。这种情况下保留 BBR 也没有害处（它不会降低吞吐），但**收益记 0** |
| 改后明显更小 | 多半是测量抖动或路径变了（换了网络、走了 CDN）。**换时间重测**，仍然更小就按 §5 回滚 |

**没有「改前」的基线数字，就无法判断这次改动是不是白做** —— 所以 §1.2 的基线不是可选项。

---

## 7. 适用面：HTTP/3 已经开着，这套配置只覆盖 TCP 那一份

线上 nginx 正在发：

```
Alt-Svc: quic=":443"; h3=":443"; h3-29=":443"; ...
```

即 **HTTP/3 是开着的**。HTTP/3 走 **UDP/QUIC**，而 **QUIC 有自己的拥塞控制，不吃 TCP 拥塞控制** ⇒ **这份配置只作用于仍留在 TCP 上的那部分流量（HTTP/1.1 + HTTP/2）**。

⚠️ 所以**不要**把这次改动说成「全站带宽翻倍」。它的适用面是 TCP 那一份：

| 访客走的是 | 受这次改动影响吗 |
| --- | --- |
| HTTP/3（QUIC / UDP） | ❌ 不受 |
| HTTP/2（TCP） | ✅ 受 |
| HTTP/1.1（TCP） | ✅ 受 |

---

## 8. 风险

| 风险 | 说明 | 怎么办 |
| --- | --- | --- |
| **单连接内存占用上升** | `rmem_max` / `wmem_max` 从 212992 提到 16777216（16 MB），并发的连接各可能占到这个量级 | 机器内存紧张时，把 `ipv4-bbr.conf` 里的 `16777216` 改成 `4194304`（4 MB），然后 `sudo sysctl --system; echo "exit=$?"` |
| **BBR 不一定更快** | 见 §6、§9：链路容量若已跑满，收益为 0 | 一定要有改前/改后两个数字 |
| **只在新建连接上体现** | 改动瞬间已有的连接仍用旧算法 | 无需处理，等它们自然断开 |
| **回滚不是删文件** | 见 §5 | 严格按三步走 |
| **`sysctl --system` 会读 `/etc/sysctl.d/` 下所有文件** | 别的文件里的失败也会让它返回非零 | 看 `error setting key` 指的是哪个键，别把它误当成这次配置失败 |
| **内核 < 4.9** | `tcp_bbr` / `sch_fq` 不可用 | 见 §3 的「内核太老怎么办」，并明确记录「BBR 未完全生效」 |

---

## 9. 它解决的是什么（以及为什么「翻数倍」只是个推断）

这条链路的实测：**RTT 250 ms**，单连接持续吞吐 **177 KB/s**。

- **BDP（带宽时延积）= 177 KB/s × 0.25 s ≈ 44 KB**
- 而 **177 KB/s 恰好等于 44 KB ÷ 0.25 s**

⚠️ 早先的措辞「Linux 默认拥塞控制的**有效窗口**约 44 KB」**不准确**，这里更正一下：

- 44 KB 是这条链路的 **BDP**，**不是**「默认拥塞控制把窗口限死在 44 KB」；
- 默认的 **cubic 是「涨到丢包为止」**的，并不以 BDP 为上限。

正确的说法是：**实测吞吐正好落在「窗口 = 1 个 BDP」的形态上**，说明这条链路当时是**窗口受限**（而不是链路容量被打满）—— 这正是 BBR 可能有数倍空间的地方。

⚠️ **但「窗口受限」是推断，不是结论**：如果这条链路的**实际容量**本来就只有 ~1.4 Mbps，那么 177 KB/s 已经跑满，**BBR 一分钱也省不出来**。所以 §6 那条「改前/改后各测一次」是**必做**的，不是可选的。

最后一句，免得混淆：这是**带宽 / 窗口**问题，和**字体瘦身（载荷问题）**是两条**独立的线** —— 一次改动不会带来两次收益，也不能互相顶替。

---

## 10. 速查：一页纸顺序

```
1. 记现状（七个键）              sudo sysctl -a > ~/sysctl-before-bbr.txt
2. 测改前速度（中国侧客户端）     curl -w 'speed=%{speed_download}' ...   ← 基线
3. 送文件到服务器                scp deploy/tuning/ipv4-bbr.conf user@host:/tmp/
4. 装到 /etc/sysctl.d/           sudo cp /tmp/ipv4-bbr.conf /etc/sysctl.d/99-ziyun-bbr.conf
5. 加载模块（各自看退出码）      sudo modprobe tcp_bbr; echo "exit=$?"
                                 sudo modprobe sch_fq;  echo "exit=$?"
6. 写进去（看退出码）            sudo sysctl --system; echo "exit=$?"
7. 确认（查两项）                sysctl net.ipv4.tcp_congestion_control   → bbr
                                 sysctl net.core.default_qdisc            → fq
                                 ss -tin | grep -i bbr
8. 测改后速度（中国侧客户端）     curl -w 'speed=%{speed_download}' ...   ← 与第 2 步比
9. 若要回滚：写回原值 → 删文件 → 复核   （顺序不能反）
```

**每一步失败了就停下，别往下走。** 尤其第 5、6 步的 `exit=` 必须是 0。
