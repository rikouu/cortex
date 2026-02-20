import { describe, it, expect } from 'vitest';
import { detectHighSignals, isSmallTalk } from '../src/signals/detector.js';

describe('Signal Detection', () => {
  describe('detectHighSignals', () => {
    // Chinese
    it('should detect Chinese identity signals', () => {
      const signals = detectHighSignals({
        user: '我叫小明，我是一个前端工程师',
        assistant: '好的，小明！',
      });
      expect(signals.some(s => s.category === 'identity')).toBe(true);
    });

    it('should detect Chinese preference signals', () => {
      const signals = detectHighSignals({
        user: '我喜欢用 TypeScript 写代码',
        assistant: '了解！',
      });
      expect(signals.some(s => s.category === 'preference')).toBe(true);
    });

    it('should detect Chinese correction signals', () => {
      const signals = detectHighSignals({
        user: '不是Python，而是JavaScript',
        assistant: '抱歉搞错了',
      });
      expect(signals.some(s => s.category === 'correction')).toBe(true);
    });

    it('should detect Chinese decision signals', () => {
      const signals = detectHighSignals({
        user: '我决定了用 React 做这个项目',
        assistant: '好的',
      });
      expect(signals.some(s => s.category === 'decision')).toBe(true);
    });

    it('should detect Chinese todo signals', () => {
      const signals = detectHighSignals({
        user: '提醒我明天早上开会',
        assistant: '好的',
      });
      expect(signals.some(s => s.category === 'todo')).toBe(true);
    });

    // English
    it('should detect English identity signals', () => {
      const signals = detectHighSignals({
        user: "I'm a software developer working at Google",
        assistant: 'Nice!',
      });
      expect(signals.some(s => s.category === 'identity')).toBe(true);
    });

    it('should detect English preference signals', () => {
      const signals = detectHighSignals({
        user: 'I prefer dark mode over light mode',
        assistant: 'Noted!',
      });
      expect(signals.some(s => s.category === 'preference')).toBe(true);
    });

    it('should detect English correction signals', () => {
      const signals = detectHighSignals({
        user: 'Actually, my timezone is JST not PST',
        assistant: 'Got it',
      });
      expect(signals.some(s => s.category === 'correction')).toBe(true);
    });

    it('should detect English decision signals', () => {
      const signals = detectHighSignals({
        user: "I've decided to use PostgreSQL for the backend",
        assistant: 'Good choice',
      });
      expect(signals.some(s => s.category === 'decision')).toBe(true);
    });

    it('should detect English todo signals', () => {
      const signals = detectHighSignals({
        user: "Remind me to buy groceries tomorrow",
        assistant: 'Sure',
      });
      expect(signals.some(s => s.category === 'todo')).toBe(true);
    });

    // Japanese
    it('should detect Japanese identity signals', () => {
      const signals = detectHighSignals({
        user: '私はエンジニアです',
        assistant: 'はい',
      });
      expect(signals.some(s => s.category === 'identity')).toBe(true);
    });

    it('should detect Japanese preference signals', () => {
      const signals = detectHighSignals({
        user: 'コーヒーが好きです',
        assistant: 'いいですね',
      });
      expect(signals.some(s => s.category === 'preference')).toBe(true);
    });

    it('should detect Japanese decision signals', () => {
      const signals = detectHighSignals({
        user: 'Reactに決めた',
        assistant: 'はい',
      });
      expect(signals.some(s => s.category === 'decision')).toBe(true);
    });

    it('should detect Japanese correction signals', () => {
      const signals = detectHighSignals({
        user: '実はそうじゃなくて別のやり方です',
        assistant: 'なるほど',
      });
      expect(signals.some(s => s.category === 'correction')).toBe(true);
    });

    it('should detect Japanese todo signals', () => {
      const signals = detectHighSignals({
        user: '忘れないでね、明日の会議',
        assistant: 'はい',
      });
      expect(signals.some(s => s.category === 'todo')).toBe(true);
    });

    // No signals
    it('should return empty for neutral conversation', () => {
      const signals = detectHighSignals({
        user: 'What is the weather today?',
        assistant: 'It is sunny.',
      });
      expect(signals.length).toBe(0);
    });

    it('should set appropriate importance and confidence', () => {
      const signals = detectHighSignals({
        user: '我叫小明',
        assistant: '你好',
      });
      const identitySignal = signals.find(s => s.category === 'identity');
      expect(identitySignal).toBeDefined();
      expect(identitySignal!.importance).toBe(1.0);
      expect(identitySignal!.confidence).toBe(0.85);
    });
  });

  describe('isSmallTalk', () => {
    it('should detect English small talk', () => {
      expect(isSmallTalk('hi')).toBe(true);
      expect(isSmallTalk('hello!')).toBe(true);
      expect(isSmallTalk('thanks')).toBe(true);
      expect(isSmallTalk('ok')).toBe(true);
      expect(isSmallTalk('bye')).toBe(true);
      expect(isSmallTalk('lol')).toBe(true);
    });

    it('should detect Chinese small talk', () => {
      expect(isSmallTalk('你好')).toBe(true);
      expect(isSmallTalk('谢谢')).toBe(true);
      expect(isSmallTalk('好的')).toBe(true);
      expect(isSmallTalk('再见')).toBe(true);
      expect(isSmallTalk('哈哈')).toBe(true);
    });

    it('should detect Japanese small talk', () => {
      expect(isSmallTalk('おはよう')).toBe(true);
      expect(isSmallTalk('こんにちは')).toBe(true);
      expect(isSmallTalk('ありがとう')).toBe(true);
      expect(isSmallTalk('はい')).toBe(true);
    });

    it('should NOT flag meaningful content as small talk', () => {
      expect(isSmallTalk('Tell me about Tokyo real estate')).toBe(false);
      expect(isSmallTalk('我想买一套公寓')).toBe(false);
      expect(isSmallTalk('東京の不動産について教えて')).toBe(false);
    });

    it('should flag very short messages', () => {
      expect(isSmallTalk('hi')).toBe(true);
      expect(isSmallTalk('ok')).toBe(true);
    });
  });
});
