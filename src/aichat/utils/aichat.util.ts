import { Repository } from 'typeorm';
import { ChatContextType, ChatType } from '../dto/create-chat-message.dto';
import { PromptConfig } from '../entities/chat-message.entity';
import { VirtualCharacter } from '../entities/virtual-character.entity';

export const getSystemPrompt = (chatContext: string) => {
  return `
You are a text explanation and question answering assistant.
`;
};

export const getRetrievalUserPrompt = (context: string, question: string) => {
  return `
Below is the retrieved context from our Deck:
${context}

Question:
${question}

Response Guidelines:
1. When responding, please use a conversational, engaging tone. Base your answer primarily on the context provided.
2. If the context doesn't fully cover the topic, feel free to supplement with your own knowledge, but make it clear when you're going beyond what was discussed in the context.
3. **重要：在回答中引用卡片时，必须严格使用上面提供的引用映射表中的确切ID**。
   - 引用格式：[引用：卡片名称 (ID: 确切的卡片ID)]
   - 例如：[引用：JavaScript基础概念 (ID: 1234567890)]
   - 不要擅自修改上述引用格式，记住，你只能使用引用格式：[引用：卡片名称 (ID: 确切的卡片ID)]
   - 绝对不要自己编造或修改ID
   - 只使用上下文中明确提供的卡片ID
   - 最后强调，不要擅自修改上述引用格式，记住，你只能使用引用格式：[引用：卡片名称 (ID: 确切的卡片ID)]
4. Use casual language, occasional humor, and a warm, approachable style.
5. If the context doesn't address the question, acknowledge this gap, offer your best insights
6. 在回答末尾，严格按照引用映射表列出所有引用的卡片：

   **引用卡片：**
   [引用：卡片名称1 (ID: 确切的卡片ID)]
   [引用：卡片名称2 (ID: 确切的卡片ID)]
   ...
   (严格复制引用映射表中的信息)
  `;
};

export function generatePrompt(
  chatcontext: ChatContextType,
  contextContent: string,
  chattype: ChatType,
  selectionText: string,
  question: string,
) {
  // 处理上下文部分
  let contextPrompt = '';
  switch (chatcontext) {
    case ChatContextType.Deck:
      contextPrompt = contextContent
        ? '以下是当前学习deck的内容作为上下文：\n\n' + contextContent + '\n\n'
        : '';
      break;
    case ChatContextType.Card:
      contextPrompt = contextContent
        ? '以下是当前card的内容作为上下文：\n\n' + contextContent + '\n\n'
        : '';
      break;
    case ChatContextType.None:
    default:
      contextPrompt = '';
      break;
  }

  // 处理用户选中的文本（只在 explain 或 ask 类型时使用）
  const selectedContent =
    (chattype === ChatType.Explain || chattype === ChatType.Ask) &&
    selectionText
      ? `选中的内容：${selectionText}\n\n`
      : '';

  // 处理问题部分（只在 generic 或 ask 类型时使用）
  const questionContent =
    (chattype === ChatType.Generic || chattype === ChatType.Ask) && question
      ? `问题：${question}\n\n`
      : '';

  // 根据应用类型构建提示词
  let typePrompt = '';
  switch (chattype) {
    case ChatType.Explain:
      typePrompt = `请对${
        selectionText ? '选中的内容' : '上下文中的知识点'
      }提供详细解释。`;
      break;

    case ChatType.Ask:
      typePrompt = `基于${selectionText ? '选中的内容' : '上下文'}，请回答

请提供全面而准确的回答，可以包括：
- 主要内容的解释
- 相关例子或应用
- 必要的背景知识
- 关键点的强调

回答应当有结构性，便于理解和记忆。`;
      break;

    case ChatType.WordLookup:
      typePrompt = `解释单词 "${selectionText}":

格式：
**词性**: [类型]
**含义**: [核心意思]
**例句**: [对应语言的单词简单例句]
**搭配**: [常用1个]

简洁回答。`;
      break;

    case ChatType.Generic:
    default:
      typePrompt = `请提供帮助：

请提供简洁明了的回答，根据问题需要可以包括解释、举例、比较或分析。`;
      break;
  }

  // 组合最终的 prompt
  const finalPrompt = `${contextPrompt}${selectedContent}${questionContent}${typePrompt}`;

  return finalPrompt;
}

export const generateSimplifiedPromptDisplay = (promptConfig: PromptConfig) => {
  const { chatcontext, contextContent, chattype, selectionText, question } =
    promptConfig;

  // 简化上下文展示
  let contextDisplay = '';
  if (contextContent) {
    switch (chatcontext) {
      case ChatContextType.Deck:
        contextDisplay = '基于该牌组，';
        break;
      case ChatContextType.Card:
        contextDisplay = '基于该卡片，';
        break;
      default:
        contextDisplay = '';
        break;
    }
  }

  // 简化选中内容展示
  const selectionDisplay = selectionText ? `关于"${selectionText}"，` : '';

  // 简化交互类型展示
  let typeDisplay = '';
  switch (chattype) {
    case ChatType.Explain:
      typeDisplay = '解释';
      break;
    case ChatType.Ask:
      typeDisplay = '回答';
      break;
    case ChatType.WordLookup:
      typeDisplay = '查词';
      break;
    case ChatType.Generic:
      typeDisplay = '回答';
      break;
  }

  // 简化问题展示
  const questionDisplay = question ? `"${question}"` : '';

  // 组合最终的简洁展示
  let simplifiedDisplay = `${contextDisplay}${selectionDisplay}${typeDisplay}${
    questionDisplay ? ` ${questionDisplay}` : ''
  }`;

  // 确保首字母大小写，结尾添加适当标点
  simplifiedDisplay =
    simplifiedDisplay.charAt(0).toUpperCase() + simplifiedDisplay.slice(1);
  if (
    !simplifiedDisplay.endsWith('.') &&
    !simplifiedDisplay.endsWith('?') &&
    !simplifiedDisplay.endsWith('!')
  ) {
    simplifiedDisplay += '.';
  }

  return simplifiedDisplay;
};

// 从数据库获取角色系统提示词
export async function getCharacterSystemPrompt(
  characterRepository: Repository<VirtualCharacter>,
  characterCode: string,
): Promise<string> {
  const character = await characterRepository.findOne({
    where: { code: characterCode, isActive: true },
  });

  return character?.systemPrompt || '';
}

// 从数据库获取角色语音ID
export async function getVoiceForCharacter(
  characterRepository: Repository<VirtualCharacter>,
  characterCode: string,
): Promise<string> {
  const character = await characterRepository.findOne({
    where: { code: characterCode, isActive: true },
  });

  return (
    character?.voiceId ||
    'cosyvoice-v2-paimeng-70ff1f7a57b744fe8b235032c305789f'
  );
}

// 获取角色配置
export async function getCharacterConfig(
  characterRepository: Repository<VirtualCharacter>,
  characterCode: string,
): Promise<{
  name: string;
  voiceId: string;
  systemPrompt: string;
  emotionPatterns: string[];
} | null> {
  const character = await characterRepository.findOne({
    where: { code: characterCode, isActive: true },
  });

  if (!character) return null;

  return {
    name: character.name,
    voiceId: character.voiceId,
    systemPrompt: character.systemPrompt,
    emotionPatterns: character.emotionPatterns,
  };
}

export function extractCleanText(text: string): string {
  return text.replace(/【表情：.+?】/g, '').trim();
}

export function extractEmotion(text: string): string | null {
  const match = text.match(/【表情：(.+?)】/);
  return match ? match[1] : null;
}
