---
name: 回合后维护
title: 回合后维护
description: 根据已落定正文与已有资料，判断并提交本轮语义变化。
triggers:
  - 玩家回合正文落定后的资料更新
appliesTo:
  - stage-manager
---

# 回合后维护

你已获得本轮正文、当前局面和相关资料。必要时使用 `lookup` 补充对象信息，然后用 `submit_changes` 提交本轮变化。

## 如何判断变化

- 只记录已经发生的事件、当前明确状态和已表达的持续目标。人物所说的话不自动等于客观事实；疑虑不等于发现秘密，形容不等于获得能力。未选选项不是已发生剧情。
- 比较旧状态，区分新增、修订、结束与不变。临时处境属于 states，稳定能力属于 traits，持续意图属于 goals，长期影响的经历属于 experiences。
- entities 与 scenes 用已有 ref 标明对象；新对象提供 key、type（场景不需要 type）和 name，同批其他变化使用 @key 引用。人物同名时先核实，不猜身份。
- states/traits/gauges 的 put 用于新增或修订，修订时带已有 id；end 只填写明确结束的条目标识。新增条目不需要 id。
- participants 表达场景结束时仍在场的对象，不是本轮曾出现的所有人。关系的 mutual 表示两边均发生该关系变化；单方认知或态度不自动双向。
- containers/contents 表达最终持有或收纳情况；已有物品在两个容器间转移用 transfers。装备物品的适用槽位与明确效果用 wearable；穿戴变化用 equipment，普通属性的明确增减用 refresh 的 attributeChanges；不要根据修辞猜测数值。
- world.plotOrder 是当前剧情到达的原著节点，结合 plotNodes 判断；节点摘要是进度参照，不代表其中全部事件已发生。本轮没有跨节点就不填写进度变化。
- milestones 记录相对原著的显著偏离（diverged）、并回（rejoined）或相近经历（aligned）；sourceOrder 指关联原著节点，原创事件用 null。只在有意义的节点填写，不做流水账。world.details 可表达月相、倒计时等额外世界状况。
- records 只记录以后值得回忆的客观事实；seeds 对照已有伏笔判断新增或发展。recall 提供一句摘要、少量重要对象、事件类别和标签。
- 同一事实可以在不同语义用途上有简短表达，但不要复制长段正文。资料不足或无法表达的新概念，明确说明，不编造缺失事实。

## 提交与回复

先组织本轮变化，再提交。未填写的资料保持不变。提交被拒绝时根据返回的语义原因修正；资料已变化时停止并说明需要重新整理。

只有返回 applied 或 already_applied，才简要报告本轮资料已更新。没有成功提交就说明未完成原因，不用文字汇报代替提交。

```json tsian-actions
[
  {
    "name": "lookup",
    "description": "查询明确对象或姓名对应的语义资料；同名候选需结合已有事实确认身份。",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "refs": {
          "type": "array",
          "maxItems": 20,
          "items": {
            "type": "string",
            "maxLength": 200
          }
        },
        "names": {
          "type": "array",
          "maxItems": 20,
          "items": {
            "type": "string",
            "maxLength": 150
          }
        }
      }
    },
    "outputSchema": {
      "type": "object"
    },
    "executor": {
      "type": "browser_script",
      "path": "scripts/lookup.js",
      "helpers": [
        "maintenance-core.js"
      ],
      "timeoutMs": 30000
    }
  },
  {
    "name": "submit_changes",
    "description": "提交本轮完整语义变化和召回摘要。未填写的内容保持不变；新对象用 key 命名，并在同批变化中用 @key 引用。",
    "inputSchema": {
      "type": "object",
      "additionalProperties": false,
      "properties": {
        "entities": {
          "type": "array",
          "maxItems": 100,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "ref": {
                "type": "string",
                "maxLength": 200
              },
              "key": {
                "type": "string",
                "maxLength": 80
              },
              "type": {
                "enum": [
                  "character",
                  "item",
                  "container",
                  "location"
                ]
              },
              "name": {
                "type": "string",
                "maxLength": 150
              },
              "summary": {
                "type": "string",
                "maxLength": 10000
              },
              "identity": {
                "type": "object",
                "additionalProperties": {
                  "type": [
                    "string",
                    "number"
                  ],
                  "maxLength": 2000
                }
              },
              "appearance": {
                "type": "string",
                "maxLength": 10000
              },
              "goals": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "current": {
                    "type": "string",
                    "maxLength": 10000
                  },
                  "shortTerm": {
                    "type": "string",
                    "maxLength": 10000
                  },
                  "longTerm": {
                    "type": "string",
                    "maxLength": 10000
                  }
                }
              },
              "background": {
                "type": "string",
                "maxLength": 10000
              },
              "gender": {
                "type": "string",
                "maxLength": 30
              },
              "aliases": {
                "type": "array",
                "maxItems": 100,
                "items": {
                  "type": "string",
                  "maxLength": 100
                }
              },
              "tags": {
                "type": "array",
                "maxItems": 100,
                "items": {
                  "type": "string",
                  "maxLength": 100
                }
              },
              "lifecycle": {
                "enum": [
                  "candidate",
                  "active",
                  "background",
                  "retired"
                ]
              },
              "visibility": {
                "enum": [
                  "player-known",
                  "hidden",
                  "future-spoiler"
                ]
              },
              "itemType": {
                "enum": [
                  "equipment",
                  "material",
                  "consumable",
                  "special",
                  "other"
                ]
              },
              "states": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "put": {
                    "type": "array",
                    "maxItems": 100,
                    "items": {
                      "type": "object",
                      "additionalProperties": false,
                      "properties": {
                        "id": {
                          "type": "string",
                          "maxLength": 200
                        },
                        "name": {
                          "type": "string",
                          "maxLength": 100
                        },
                        "description": {
                          "type": "string",
                          "maxLength": 10000
                        },
                        "polarity": {
                          "enum": [
                            "positive",
                            "negative",
                            "neutral"
                          ]
                        }
                      },
                      "required": [
                        "name"
                      ]
                    }
                  },
                  "end": {
                    "type": "array",
                    "maxItems": 100,
                    "items": {
                      "type": "string",
                      "maxLength": 200
                    }
                  }
                }
              },
              "traits": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "put": {
                    "type": "array",
                    "maxItems": 100,
                    "items": {
                      "type": "object",
                      "additionalProperties": false,
                      "properties": {
                        "id": {
                          "type": "string",
                          "maxLength": 200
                        },
                        "name": {
                          "type": "string",
                          "maxLength": 100
                        },
                        "description": {
                          "type": "string",
                          "maxLength": 10000
                        },
                        "effects": {
                          "type": "array",
                          "maxItems": 100,
                          "items": {
                            "type": "string",
                            "maxLength": 1000
                          }
                        }
                      },
                      "required": [
                        "name"
                      ]
                    }
                  },
                  "end": {
                    "type": "array",
                    "maxItems": 100,
                    "items": {
                      "type": "string",
                      "maxLength": 200
                    }
                  }
                }
              },
              "gauges": {
                "type": "object",
                "additionalProperties": false,
                "properties": {
                  "put": {
                    "type": "array",
                    "maxItems": 100,
                    "items": {
                      "type": "object",
                      "additionalProperties": false,
                      "properties": {
                        "id": {
                          "type": "string",
                          "maxLength": 200
                        },
                        "name": {
                          "type": "string",
                          "maxLength": 100
                        },
                        "value": {
                          "type": "number"
                        },
                        "min": {
                          "type": "number"
                        },
                        "max": {
                          "type": "number"
                        },
                        "unit": {
                          "type": "string",
                          "maxLength": 40
                        }
                      },
                      "required": [
                        "name",
                        "value"
                      ]
                    }
                  },
                  "end": {
                    "type": "array",
                    "maxItems": 100,
                    "items": {
                      "type": "string",
                      "maxLength": 200
                    }
                  }
                }
              },
              "experiences": {
                "type": "array",
                "maxItems": 100,
                "items": {
                  "type": "string",
                  "maxLength": 10000
                }
              },
              "containers": {
                "type": "array",
                "maxItems": 100,
                "items": {
                  "type": "string",
                  "maxLength": 200
                }
              },
              "contents": {
                "type": "array",
                "maxItems": 100,
                "items": {
                  "type": "object",
                  "additionalProperties": false,
                  "properties": {
                    "ref": {
                      "type": "string",
                      "maxLength": 200
                    },
                    "quantity": {
                      "type": "integer",
                      "minimum": 1
                    }
                  },
                  "required": [
                    "ref"
                  ]
                }
              },
              "details": {
                "type": "object",
                "additionalProperties": {
                  "anyOf": [
                    {
                      "type": "string",
                      "maxLength": 10000
                    },
                    {
                      "type": "number"
                    },
                    {
                      "type": "array",
                      "maxItems": 100,
                      "items": {
                        "type": "string",
                        "maxLength": 10000
                      }
                    },
                    {
                      "type": "null"
                    }
                  ]
                }
              },
              "wearable": {
                "type": "object",
                "additionalProperties": false,
                "required": [
                  "slot"
                ],
                "properties": {
                  "slot": {
                    "type": "string",
                    "maxLength": 80
                  },
                  "add": {
                    "type": "object",
                    "additionalProperties": {
                      "type": "integer"
                    }
                  },
                  "percent": {
                    "type": "object",
                    "additionalProperties": {
                      "type": "integer"
                    }
                  },
                  "effects": {
                    "type": "array",
                    "maxItems": 100,
                    "items": {
                      "type": "string",
                      "maxLength": 1000
                    }
                  }
                }
              }
            }
          }
        },
        "scenes": {
          "type": "array",
          "maxItems": 100,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "ref": {
                "type": "string",
                "maxLength": 200
              },
              "key": {
                "type": "string",
                "maxLength": 80
              },
              "name": {
                "type": "string",
                "maxLength": 150
              },
              "location": {
                "type": "string",
                "maxLength": 200
              },
              "participants": {
                "type": "array",
                "maxItems": 100,
                "items": {
                  "type": "string",
                  "maxLength": 200
                }
              },
              "status": {
                "enum": [
                  "active",
                  "background",
                  "resolved"
                ]
              },
              "situation": {
                "type": "string",
                "maxLength": 10000
              },
              "time": {
                "type": "string",
                "maxLength": 300
              }
            }
          }
        },
        "relationships": {
          "type": "array",
          "maxItems": 100,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "from": {
                "type": "string",
                "maxLength": 200
              },
              "to": {
                "type": "string",
                "maxLength": 200
              },
              "kind": {
                "type": "string",
                "maxLength": 100
              },
              "description": {
                "type": "string",
                "maxLength": 10000
              },
              "mutual": {
                "type": "boolean"
              },
              "end": {
                "type": "boolean"
              }
            },
            "required": [
              "from",
              "to",
              "kind"
            ]
          }
        },
        "transfers": {
          "type": "array",
          "maxItems": 100,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "item": {
                "type": "string",
                "maxLength": 200
              },
              "from": {
                "type": "string",
                "maxLength": 200
              },
              "to": {
                "type": "string",
                "maxLength": 200
              },
              "quantity": {
                "type": "integer",
                "minimum": 1
              }
            },
            "required": [
              "item",
              "from",
              "to",
              "quantity"
            ]
          }
        },
        "equipment": {
          "type": "array",
          "maxItems": 100,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "character": {
                "type": "string",
                "maxLength": 200
              },
              "operation": {
                "enum": [
                  "equip",
                  "unequip",
                  "refresh"
                ]
              },
              "slot": {
                "type": "string",
                "maxLength": 100
              },
              "index": {
                "type": "integer",
                "minimum": 0
              },
              "item": {
                "type": "string",
                "maxLength": 200
              },
              "attributeChanges": {
                "type": "object",
                "additionalProperties": {
                  "type": "integer",
                  "minimum": -9007199254740991,
                  "maximum": 9007199254740991
                }
              }
            },
            "required": [
              "character",
              "operation"
            ]
          }
        },
        "world": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "time": {
              "type": "string",
              "maxLength": 300
            },
            "weather": {
              "type": "string",
              "maxLength": 300
            },
            "location": {
              "type": [
                "string",
                "null"
              ]
            },
            "activeScenes": {
              "type": "array",
              "maxItems": 100,
              "items": {
                "type": "string",
                "maxLength": 200
              }
            },
            "plotOrder": {
              "type": "integer",
              "minimum": 0
            },
            "details": {
              "type": "object",
              "additionalProperties": {
                "anyOf": [
                  {
                    "type": "string",
                    "maxLength": 10000
                  },
                  {
                    "type": "number"
                  },
                  {
                    "type": "array",
                    "maxItems": 100,
                    "items": {
                      "type": "string",
                      "maxLength": 10000
                    }
                  },
                  {
                    "type": "null"
                  }
                ]
              }
            }
          }
        },
        "records": {
          "type": "array",
          "maxItems": 100,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "kind": {
                "enum": [
                  "recall",
                  "scene",
                  "npc_action"
                ]
              },
              "keywords": {
                "type": "string",
                "maxLength": 150
              },
              "summary": {
                "type": "string",
                "maxLength": 1000
              }
            },
            "required": [
              "kind",
              "keywords",
              "summary"
            ]
          }
        },
        "seeds": {
          "type": "array",
          "maxItems": 100,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
              "name": {
                "type": "string",
                "maxLength": 150
              },
              "status": {
                "enum": [
                  "planted",
                  "developing",
                  "resolved",
                  "abandoned"
                ]
              }
            },
            "required": [
              "name",
              "status"
            ]
          }
        },
        "recall": {
          "type": "object",
          "additionalProperties": false,
          "properties": {
            "summary": {
              "type": "string",
              "maxLength": 240
            },
            "entities": {
              "type": "array",
              "maxItems": 8,
              "items": {
                "type": "string",
                "maxLength": 200
              }
            },
            "events": {
              "type": "array",
              "maxItems": 15,
              "items": {
                "enum": [
                  "对话交流",
                  "玩家选择",
                  "冲突争执",
                  "关系变化",
                  "承诺亏欠",
                  "秘密揭露",
                  "发现线索",
                  "物品变化",
                  "状态变化",
                  "场景变化",
                  "战斗危险",
                  "计划目标",
                  "交易谈判",
                  "亲密暧昧",
                  "伏笔回收"
                ]
              }
            },
            "tags": {
              "type": "array",
              "maxItems": 12,
              "items": {
                "type": "string",
                "maxLength": 30
              }
            }
          },
          "required": [
            "summary",
            "entities",
            "events",
            "tags"
          ]
        },
        "milestones": {
          "type": "array",
          "maxItems": 10,
          "items": {
            "type": "object",
            "additionalProperties": false,
            "required": [
              "label",
              "alignment",
              "sourceOrder"
            ],
            "properties": {
              "label": {
                "type": "string",
                "maxLength": 240
              },
              "alignment": {
                "enum": [
                  "diverged",
                  "rejoined",
                  "aligned"
                ]
              },
              "sourceOrder": {
                "type": [
                  "integer",
                  "null"
                ],
                "minimum": 0
              },
              "plotOrder": {
                "type": "integer",
                "minimum": 0
              }
            }
          }
        }
      },
      "required": [
        "recall"
      ]
    },
    "outputSchema": {
      "type": "object"
    },
    "executor": {
      "type": "browser_script",
      "path": "scripts/submit.js",
      "helpers": [
        "maintenance-core.js",
        "/agents/stage-manager/skills/装备管理/scripts/equipment-core.js"
      ],
      "timeoutMs": 30000
    }
  }
]
```
