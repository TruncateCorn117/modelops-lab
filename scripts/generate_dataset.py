#!/usr/bin/env python3
"""Reproduce the hand-designed template-synthetic manufacturing fixture.

No external model, company record, random sampling, or network access is used.
The expected labels are authored through the scenarios and explicit field rules
below, not inferred from the rendered ticket text. See docs/DATA_CARD.md.
"""

import json
from datetime import date, timedelta
from pathlib import Path

# category, device, symptom, action; ten independently authored scenarios per class.
SCENARIOS = {
    "mechanical": [
        ("贴标机", "传动皮带磨损导致走纸偏移", "更换传动皮带并重新调整张力"),
        ("输送机", "滚筒轴承异响且伴随振动", "更换轴承并补充润滑脂"),
        ("封箱机", "导向轮松动造成纸箱卡滞", "紧固导向轮并完成试运行"),
        ("包装机", "气缸密封圈老化出现漏气", "更换密封圈并进行保压检查"),
        ("压装机", "定位销磨损导致压装位置偏差", "更换定位销后校验定位尺寸"),
        ("分拣机", "链条张力不足造成跳齿", "调整链条张力并检查链轮"),
        ("送料机", "滑轨积尘造成滑块运动卡滞", "清理滑轨并补充润滑油"),
        ("搅拌机", "联轴器连接螺栓松动", "按维护规程紧固连接螺栓"),
        ("空压机", "排气管接头密封不良出现泄漏", "更换接头密封垫并复查泄漏"),
        ("切割机", "刀具磨损导致切口出现毛刺", "更换刀具并检查首件切口"),
    ],
    "electrical": [
        ("贴标机", "光电传感器信号间歇丢失", "重新固定传感器接线端子"),
        ("输送机", "电机过载导致断路器跳闸", "检查电机接线后复位断路器"),
        ("封箱机", "接触器触点氧化导致无法启动", "更换接触器并测试启动回路"),
        ("包装机", "电源电压波动导致设备重启", "检修电源模块并记录输出电压"),
        ("压装机", "急停按钮触点接触不良", "更换急停按钮并测试安全回路"),
        ("分拣机", "编码器电缆屏蔽层破损导致信号干扰", "更换编码器电缆并恢复屏蔽接地"),
        ("送料机", "接近开关损坏导致到位信号缺失", "更换接近开关并调整检测距离"),
        ("搅拌机", "变频器散热风扇断路", "更换风扇后测试变频器温升"),
        ("空压机", "温度传感器接线松脱", "重新连接温度传感器并校验读数"),
        ("切割机", "控制柜继电器线圈烧毁", "更换继电器并检查供电回路"),
    ],
    "software": [
        ("贴标机", "打印程序读取工单模板失败", "恢复模板配置并重新加载程序"),
        ("输送机", "调度软件任务队列阻塞", "清理异常任务并重启调度服务"),
        ("封箱机", "操作界面显示旧版本参数", "刷新界面缓存并同步参数版本"),
        ("包装机", "配方配置缺少必填参数", "补全配方参数并重新校验配置"),
        ("压装机", "采集服务与数据库连接超时", "恢复数据库连接并补传缓存数据"),
        ("分拣机", "网络配置变更后无法连接调度服务", "修正网络配置并验证服务连接"),
        ("送料机", "控制程序版本不一致导致任务拒绝", "统一程序版本并重新下发任务"),
        ("搅拌机", "监控软件日志目录已满", "归档历史日志并调整保留配置"),
        ("空压机", "固件升级后时间配置丢失", "恢复时间配置并验证重启行为"),
        ("切割机", "排程接口返回重复任务编号", "修正接口去重逻辑并重放测试任务"),
    ],
    "other": [
        ("贴标机", "标签耗材用尽需要补料", "补充标签卷并登记耗材数量"),
        ("输送机", "工位待清洁但设备运行正常", "完成工位清洁并记录检查结果"),
        ("封箱机", "包装胶带库存不足", "补充包装胶带并通知仓库备料"),
        ("包装机", "来料外包装破损需暂存复核", "隔离破损包装并登记复核单"),
        ("压装机", "班组交接记录缺少签名", "补齐交接记录并完成复核"),
        ("分拣机", "周转箱标签与物料清单不一致", "核对物料清单并更新周转箱标签"),
        ("送料机", "待加工物料尚未送达工位", "登记缺料并协调补充物料"),
        ("搅拌机", "例行清洁任务到期", "完成清洁并更新维护记录"),
        ("空压机", "例行巡检未发现异常", "记录巡检结果并保持运行"),
        ("切割机", "成品收集箱已满需要周转", "更换空收集箱并登记周转数量"),
    ],
}

CATEGORY_NAMES = {"mechanical": "机械", "electrical": "电气", "software": "软件", "other": "其他"}
LABELS = {
    "equipment_id": "设备编号",
    "equipment": "设备",
    "production_line": "产线",
    "reported_at": "报告日期",
    "fault_code": "故障码",
    "category": "类别",
    "symptom": "现象",
    "action_taken": "处理措施",
    "downtime_minutes": "停机时长",
}


def build_rows():
    rows = []
    for class_index, (category, scenarios) in enumerate(SCENARIOS.items()):
        for scenario_index, (equipment, symptom, action) in enumerate(scenarios):
            # Entire scenario groups stay in one split; templates are shared.
            split = "dev" if scenario_index % 5 < 3 else "test"
            for variant in range(4):
                index = class_index * 40 + scenario_index * 4 + variant
                reported_at = (date(2025, 1, 1) + timedelta(days=index * 2)).isoformat()
                expected = {
                    "equipment_id": f"EQ-{class_index + 1}{scenario_index:02d}-{variant + 1}",
                    "equipment": equipment,
                    "production_line": f"{index % 8 + 1}号产线",
                    "reported_at": reported_at,
                    "fault_code": f"E{class_index + 1}{scenario_index:02d}",
                    "category": category,
                    "symptom": symptom,
                    "action_taken": action,
                    "downtime_minutes": (scenario_index * 7 + variant * 11 + class_index * 3) % 65 + 1,
                }
                # Controlled missingness and negative statements are part of
                # the expected record, not inferred by running the demo parser.
                if index % 7 == 0:
                    expected["equipment_id"] = None
                if index % 11 == 0:
                    expected["production_line"] = None
                if index % 13 == 0:
                    expected["reported_at"] = None
                if index % 5 == 0 or category == "other":
                    expected["fault_code"] = None
                if index % 9 == 0:
                    expected["action_taken"] = None
                if index % 17 == 0:
                    expected["downtime_minutes"] = None
                elif index % 6 == 0 or category == "other":
                    expected["downtime_minutes"] = 0

                fields = []
                for key, value in expected.items():
                    # An explicit class appears only in 25% of tickets. The
                    # rest require classification from the symptom/context.
                    if key == "category":
                        if variant != 0:
                            continue
                        value = CATEGORY_NAMES[category]
                    if value is None:
                        if (index + len(fields)) % 2:
                            continue
                        value = "无故障码" if key == "fault_code" else "未记录"
                    elif key == "downtime_minutes":
                        value = "未停机" if value == 0 else f"{value}分钟"
                    elif key == "reported_at" and variant == 2:
                        year, month, day = value.split("-")
                        value = f"{year}年{int(month)}月{int(day)}日"
                    fields.append((LABELS[key], value))

                # Deterministic field order changes and four readable formats.
                if variant == 1:
                    fields = fields[3:] + fields[:3]
                elif variant == 3:
                    fields.reverse()
                separator, equals = [("；", "："), ("\n", ": "), (" | ", "="), ("。", "：")][variant]
                body = separator.join(f"{key}{equals}{value}" for key, value in fields)
                context = ["现场维修记录", "班组报修单", "设备巡查记录", "工单补充记录"][variant]
                # Negation context should not override explicit observations.
                note = "\n备注：无需从其他历史工单补全未记录字段。"
                if index % 10 == 0:
                    note += "本记录未确认任何其他故障原因。"
                rows.append(
                    {
                        "id": f"SYN-{index + 1:04d}",
                        "text": f"{context}\n{body}{note}",
                        "expected": expected,
                        "split": split,
                    }
                )
    # The runner takes a deterministic prefix; interleaving avoids a small
    # sample accidentally containing only the first category.
    rows.sort(key=lambda row: ((int(row["id"][4:]) - 1) % 40, (int(row["id"][4:]) - 1) // 40))
    return rows


def main():
    rows = build_rows()
    assert len(rows) == 160
    assert len({row["text"] for row in rows}) == len(rows)
    dataset = {
        "name": "制造业合成工单 · v1",
        "description": "160条人工设计场景的模板合成工单，四类均衡，dev 96条/test 64条；用于流程验证而非生产质量证明。",
        "source": "synthetic",
        "revision": "1.0",
        "rows": rows,
    }
    destination = Path(__file__).resolve().parents[1] / "data" / "manufacturing_tickets.json"
    destination.write_text(json.dumps(dataset, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(rows)} synthetic rows to {destination}")


if __name__ == "__main__":
    main()
