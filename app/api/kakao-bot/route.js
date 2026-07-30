// app/api/kakao-bot/route.js
// Next.js App Router 방식 카카오 챗봇 웹훅

import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const body = await request.json();
    const userMessage = body?.userRequest?.utterance || '';
    const userId = body?.userRequest?.user?.id || 'unknown';

    console.log(`[유비봇] 사용자(${userId}): ${userMessage}`);

    // Claude API로 유비 말투 답변 생성
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
        system: `당신은 반영구 시술 전문가 유비입니다.

유비 프로필:
- 이마라인 모발 시술 전문 시술사
- 현직 BJ 출신, 친근하고 따뜻한 성격
- 8월 샵 오픈 예정
- 진솔하고 공감 잘하는 언니 느낌

답변 규칙:
- 유비 본인 말투로 (친근한 언니 느낌)
- 이모지 적절히 사용 😊
- 3~4줄 이내로 간결하게
- 전문성과 친근함 동시에
- 상담/예약으로 자연스럽게 연결
- 가격은 "상담 후 안내"로 처리
- 예약은 "DM 또는 이 채널로 문의" 안내

자주 묻는 질문 기본 답변:
- 가격: "시술 종류와 범위에 따라 달라져서 상담 후 정확히 안내드려요 😊"
- 통증: "개인차가 있지만 마취크림 사용해서 많이 편해요!"
- 지속기간: "보통 1~2년이고 리터치로 유지 가능해요"
- 예약: "날짜 말씀해주시면 확인해드릴게요 🌿"`,
        messages: [
          { role: 'user', content: userMessage }
        ]
      })
    });

    const claudeData = await claudeRes.json();
    const replyText = claudeData.content?.[0]?.text ||
      '안녕하세요! 문의 감사해요 😊 조금 더 자세히 말씀해주시면 답변드릴게요!';

    console.log(`[유비봇] 답변: ${replyText}`);

    // 카카오 오픈빌더 응답 포맷
    return NextResponse.json({
      version: '2.0',
      template: {
        outputs: [
          {
            simpleText: {
              text: replyText
            }
          }
        ],
        quickReplies: [
          {
            label: '📅 예약하기',
            action: 'message',
            messageText: '예약 문의드려요!'
          },
          {
            label: '💰 가격 문의',
            action: 'message',
            messageText: '시술 가격이 궁금해요'
          },
          {
            label: '📞 상담 신청',
            action: 'message',
            messageText: '상담 받고 싶어요'
          }
        ]
      }
    });

  } catch (error) {
    console.error('[유비봇] 오류:', error);

    return NextResponse.json({
      version: '2.0',
      template: {
        outputs: [
          {
            simpleText: {
              text: '안녕하세요! 유비예요 😊\n잠시 후 다시 문의해주시거나\nDM으로 연락 주시면 바로 답변드릴게요!'
            }
          }
        ]
      }
    });
  }
}

// GET 요청 처리 (테스트용)
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    message: '유비봇 API가 정상 작동 중입니다 😊'
  });
}
