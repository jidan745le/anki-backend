import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Deck } from './entities/deck.entity';
import { UserDeck } from './entities/user-deck.entity';

@Injectable()
export class DeckReferenceService {
  private readonly logger = new Logger(DeckReferenceService.name);

  constructor(
    @InjectRepository(Deck)
    private readonly deckRepository: Repository<Deck>,
    @InjectRepository(UserDeck)
    private readonly userDeckRepository: Repository<UserDeck>,
  ) {}

  /**
   * 检查deck是否可以物理删除
   * 当referenceCount只有1个时就可以物理删除
   * @param deckId 牌组ID
   * @param userId 当前操作用户ID
   */
  async canPhysicallyDelete(deckId: number, userId: number): Promise<boolean> {
    const deck = await this.deckRepository.findOne({
      where: { id: deckId },
      withDeleted: false, // 只查找未软删除的deck
    });

    if (!deck) {
      this.logger.warn(`Deck ${deckId} not found`);
      return false;
    }

    // 检查referenceCount是否为1
    const referenceCount = deck.referenceCount || 0;

    this.logger.log(
      `Deck ${deckId} has ${referenceCount} references. User: ${userId}`,
    );

    // 如果引用计数为1，可以物理删除
    const canDelete = referenceCount <= 1;
    this.logger.log(`Can physically delete deck ${deckId}: ${canDelete}`);

    return canDelete;
  }

  /**
   * 获取deck的活跃用户数量
   * @param deckId 牌组ID
   */
  async getActiveUserCount(deckId: number): Promise<number> {
    return await this.userDeckRepository.count({
      where: { deck: { id: deckId } },
      withDeleted: false,
    });
  }

  /**
   * 软删除deck及其相关数据
   * @param deckId 牌组ID
   */
  async softDeleteDeck(deckId: number): Promise<void> {
    // 软删除deck
    await this.deckRepository.softDelete({ id: deckId });

    // 软删除相关的cards
    await this.deckRepository.query(
      'UPDATE cards SET deletedAt = NOW() WHERE deck_id = ?',
      [deckId],
    );

    this.logger.log(`Soft deleted deck ${deckId} and its cards`);
  }

  /**
   * 增加deck的引用计数
   * @param deckId 牌组ID
   * @param userId 用户ID（用于日志）
   */
  async incrementReference(deckId: number, userId?: number): Promise<void> {
    const deck = await this.deckRepository.findOne({
      where: { id: deckId },
      withDeleted: false,
    });

    if (deck) {
      deck.referenceCount = (deck.referenceCount || 0) + 1;
      await this.deckRepository.save(deck);
      this.logger.log(
        `Incremented reference count for deck ${deckId} to ${deck.referenceCount} (user: ${userId})`,
      );
    }
  }

  /**
   * 减少deck的引用计数
   * @param deckId 牌组ID
   * @param userId 用户ID（用于日志）
   * @returns 返回当前引用计数
   */
  async decrementReference(deckId: number, userId?: number): Promise<number> {
    const deck = await this.deckRepository.findOne({
      where: { id: deckId },
      withDeleted: false,
    });

    if (deck) {
      deck.referenceCount = Math.max((deck.referenceCount || 1) - 1, 0);
      await this.deckRepository.save(deck);
      this.logger.log(
        `Decremented reference count for deck ${deckId} to ${deck.referenceCount} (user: ${userId})`,
      );
      return deck.referenceCount;
    }
    return 0;
  }

  /**
   * 物理删除deck（保持原有CASCADE行为）
   * @param deckId 牌组ID
   */
  async physicallyDeleteDeck(deckId: number): Promise<void> {
    // 直接删除deck，CASCADE会自动删除相关数据
    await this.deckRepository.delete({ id: deckId });

    this.logger.log(`Physically deleted deck ${deckId} and all related data`);
  }

  /**
   * 同步所有deck的引用计数（用于数据修复）
   */
  async syncAllReferenceCount(): Promise<{ synced: number; message: string }> {
    this.logger.log('Starting reference count synchronization...');

    const decks = await this.deckRepository.find({ withDeleted: false });
    let syncedCount = 0;

    for (const deck of decks) {
      const activeUserDeckCount = await this.userDeckRepository.count({
        where: { deck: { id: deck.id } },
        withDeleted: false, // 只计算未软删除的记录
      });

      if (deck.referenceCount !== activeUserDeckCount) {
        this.logger.log(
          `Syncing deck ${deck.id}: ${deck.referenceCount} -> ${activeUserDeckCount}`,
        );
        deck.referenceCount = activeUserDeckCount;
        await this.deckRepository.save(deck);
        syncedCount++;
      }
    }

    this.logger.log(
      `Reference count synchronization completed. Synced ${syncedCount} decks.`,
    );

    return {
      synced: syncedCount,
      message: `Synchronized reference count for ${syncedCount} decks`,
    };
  }
}
