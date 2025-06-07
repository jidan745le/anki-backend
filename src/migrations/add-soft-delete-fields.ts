import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSoftDeleteFields1704614400000 implements MigrationInterface {
  name = 'AddSoftDeleteFields1704614400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 为 decks 表添加软删除字段和引用计数字段
    await queryRunner.query(`
      ALTER TABLE \`decks\` 
      ADD COLUMN \`deletedAt\` datetime(6) NULL,
      ADD COLUMN \`referenceCount\` int NOT NULL DEFAULT 0
    `);

    // 为 cards 表添加软删除字段
    await queryRunner.query(`
      ALTER TABLE \`cards\` 
      ADD COLUMN \`deletedAt\` datetime(6) NULL
    `);

    // 为 user_decks 表添加软删除字段
    await queryRunner.query(`
      ALTER TABLE \`user_decks\` 
      ADD COLUMN \`deletedAt\` datetime(6) NULL
    `);

    // 为 user_cards 表添加软删除字段
    await queryRunner.query(`
      ALTER TABLE \`user_cards\` 
      ADD COLUMN \`deletedAt\` datetime(6) NULL
    `);

    // 初始化现有记录的引用计数
    await queryRunner.query(`
      UPDATE \`decks\` d 
      SET \`referenceCount\` = (
          SELECT COUNT(*) 
          FROM \`user_decks\` ud 
          WHERE ud.\`deck_id\` = d.\`id\`
      )
    `);

    // 创建索引来提高软删除查询性能
    await queryRunner.query(`
      CREATE INDEX \`IDX_decks_deleted_at\` ON \`decks\` (\`deletedAt\`)
    `);
    await queryRunner.query(`
      CREATE INDEX \`IDX_cards_deleted_at\` ON \`cards\` (\`deletedAt\`)
    `);
    await queryRunner.query(`
      CREATE INDEX \`IDX_user_decks_deleted_at\` ON \`user_decks\` (\`deletedAt\`)
    `);
    await queryRunner.query(`
      CREATE INDEX \`IDX_user_cards_deleted_at\` ON \`user_cards\` (\`deletedAt\`)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 删除索引
    await queryRunner.query(
      `DROP INDEX \`IDX_user_cards_deleted_at\` ON \`user_cards\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_user_decks_deleted_at\` ON \`user_decks\``,
    );
    await queryRunner.query(`DROP INDEX \`IDX_cards_deleted_at\` ON \`cards\``);
    await queryRunner.query(`DROP INDEX \`IDX_decks_deleted_at\` ON \`decks\``);

    // 删除字段
    await queryRunner.query(
      `ALTER TABLE \`user_cards\` DROP COLUMN \`deletedAt\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`user_decks\` DROP COLUMN \`deletedAt\``,
    );
    await queryRunner.query(`ALTER TABLE \`cards\` DROP COLUMN \`deletedAt\``);
    await queryRunner.query(
      `ALTER TABLE \`decks\` DROP COLUMN \`referenceCount\``,
    );
    await queryRunner.query(`ALTER TABLE \`decks\` DROP COLUMN \`deletedAt\``);
  }
}
