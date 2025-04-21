import { MigrationInterface, QueryRunner } from 'typeorm';

export class UserDeckRelationMigration1745234567890
  implements MigrationInterface
{
  name = 'UserDeckRelationMigration1745234567890';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. 创建新的关联表
    await queryRunner.query(`
            CREATE TABLE \`user_decks\` (
                \`id\` int NOT NULL AUTO_INCREMENT,
                \`fsrsParameters\` json NULL,
                \`lastPosition\` int NOT NULL DEFAULT '0',
                \`newCardsPerDay\` int NOT NULL DEFAULT '20',
                \`reviewsPerDay\` int NOT NULL DEFAULT '100',
                \`totalReviews\` int NOT NULL DEFAULT '0',
                \`correctReviews\` int NOT NULL DEFAULT '0',
                \`studyTimeMinutes\` int NOT NULL DEFAULT '0',
                \`canEdit\` tinyint NOT NULL DEFAULT '1',
                \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
                \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                \`user_id\` int NULL,
                \`deck_id\` int NULL,
                PRIMARY KEY (\`id\`)
            ) ENGINE=InnoDB
        `);

    // 2. 添加外键
    await queryRunner.query(`
            ALTER TABLE \`user_decks\` 
            ADD CONSTRAINT \`FK_user_decks_user\` 
            FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) 
            ON DELETE CASCADE
        `);

    await queryRunner.query(`
            ALTER TABLE \`user_decks\` 
            ADD CONSTRAINT \`FK_user_decks_deck\` 
            FOREIGN KEY (\`deck_id\`) REFERENCES \`decks\`(\`id\`) 
            ON DELETE CASCADE
        `);

    // 3. 添加唯一约束确保一个用户只有一条与同一牌组的关系记录
    await queryRunner.query(`
            ALTER TABLE \`user_decks\` 
            ADD UNIQUE INDEX \`IDX_user_deck_unique\` (\`user_id\`, \`deck_id\`)
        `);

    // 4. 迁移现有数据到关联表
    await queryRunner.query(`
            INSERT INTO \`user_decks\` (\`user_id\`, \`deck_id\`)
            SELECT \`user_id\`, \`id\` FROM \`decks\` WHERE \`user_id\` IS NOT NULL
        `);

    // 5. 添加creatorId列作为原始user_id的备份
    await queryRunner.query(`
            ALTER TABLE \`decks\` 
            ADD COLUMN \`creatorId\` int NULL
        `);

    // 6. 将user_id值复制到creatorId
    await queryRunner.query(`
            UPDATE \`decks\` SET \`creatorId\` = \`user_id\` WHERE \`user_id\` IS NOT NULL
        `);

    // 7. 删除原有的外键和列
    await queryRunner.query(`
            ALTER TABLE \`decks\` DROP FOREIGN KEY \`FK_decks_user\`
        `);

    await queryRunner.query(`
            ALTER TABLE \`decks\` DROP COLUMN \`user_id\`
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 1. 恢复原有的列
    await queryRunner.query(`
            ALTER TABLE \`decks\` ADD COLUMN \`user_id\` int NULL
        `);

    // 2. 添加外键
    await queryRunner.query(`
            ALTER TABLE \`decks\` 
            ADD CONSTRAINT \`FK_decks_user\` 
            FOREIGN KEY (\`user_id\`) REFERENCES \`user\`(\`id\`) 
            ON DELETE CASCADE
        `);

    // 3. 将creatorId复制回user_id
    await queryRunner.query(`
            UPDATE \`decks\` SET \`user_id\` = \`creatorId\` WHERE \`creatorId\` IS NOT NULL
        `);

    // 4. 删除creatorId列
    await queryRunner.query(`
            ALTER TABLE \`decks\` DROP COLUMN \`creatorId\`
        `);

    // 5. 删除关联表
    await queryRunner.query(`
            DROP TABLE \`user_decks\`
        `);
  }
}
