# 덱 가져오기 형식

## JSON (`format: "flashdeck"`)

```json
{
  "format": "flashdeck",
  "version": 1,
  "title": "덱 제목",
  "language": "en",
  "cards": [
    { "id": "c_001", "type": "open", "group": "Short-answer", "topic": "Weather",
      "question": "What does ILS stand for?",
      "answer": [{ "text": "Instrument Landing System.", "translated": false }],
      "note": "선택: 답 아래 작은 기울임체로 표시" },
    { "id": "c_002", "type": "truefalse", "group": "Sample", "topic": "Sample",
      "question": "ATC stands for Air Traffic Control.", "correct": true, "explanation": "선택" },
    { "id": "c_003", "type": "single", "group": "Sample", "topic": "Sample",
      "question": "…", "options": ["A", "B", "C", "D"], "correct": [1], "explanation": "선택" },
    { "id": "c_004", "type": "multiple", "group": "Sample", "topic": "Sample",
      "question": "…", "options": ["A", "B", "C", "D"], "correct": [0, 2] }
  ]
}
```

| 필드 | 설명 |
| --- | --- |
| `id` | 카드의 안정적인 고유 문자열. 진행 기록이 이 값에 묶이므로 덱을 고쳐 다시 가져와도 바꾸지 마세요. 덱 안에서 중복 불가 |
| `type` | `open` · `truefalse` · `single` · `multiple` |
| `group`, `topic` | 필터와 카테고리에 쓰입니다. 없으면 “기타” |
| `question` | 필수. `questionTranslated: true`이면 “번역” 라벨 표시 |
| `answer` (open) | `{text, translated}` 세그먼트 배열. `translated: true`는 주황색 + “번역” 라벨 |
| `correct` | truefalse는 `true/false`, single/multiple은 정답 보기 **인덱스(0부터)** 배열. single은 정확히 1개 |
| `options` | single/multiple 필수, 2개 이상. 학습 때마다 순서가 섞입니다 |
| `explanation`, `note` | 선택 |

multiple은 전부 맞아야 정답(all-or-nothing)입니다.

## CSV (엑셀에서 작성)

첫 줄은 헤더입니다. UTF-8로 저장하세요 (쉼표/세미콜론/탭 구분 자동 인식).

```
type,group,topic,question,answer,option1,option2,option3,option4,correct,explanation
open,Short-answer,Weather,"What does ILS stand for?","Instrument Landing System."
truefalse,Sample,Sample,"ATC stands for Air Traffic Control.",,,,,,true,"선택"
single,Sample,Sample,"Primary control surface?",,Flaps,Elevator,Spoiler,Slat,2,
multiple,Sample,Sample,"Select all primary surfaces",,Aileron,Elevator,Rudder,Flap,1;2;3,
```

- 필수 열: `type`, `question`. 선택 열: `group`, `topic`, `answer`, `option1…N`, `correct`, `explanation`, `note`, `id`
- CSV의 `correct`는 **1부터 센 보기 번호**이고, 여러 개는 `;`로 구분합니다 (JSON과 달리 1부터). truefalse는 `true`/`false`.
- `id`를 비워 두면 질문 텍스트로 자동 생성합니다 (`c_` + 소문자·기호 제거한 질문의 SHA-1 앞 12자리). 질문이 같은 카드가 둘 이상이면 답/보기까지 섞어 구분합니다.
- 덱 제목은 파일 이름(확장자 제외)이 됩니다.

## 가져올 때 검사하는 항목

형식이 틀리면 파일 단위로 가져오지 않고 오류 목록을 보여 줍니다: 필수 필드 누락, 알 수 없는 `type`, `id` 중복, `correct`가 보기 범위를 벗어남, single에 정답이 2개 이상, 빈 `answer`, JSON 구문 오류 등.
