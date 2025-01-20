import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUUidAndAddChatEntity1737286893241
  implements MigrationInterface
{
  name = 'AddUUidAndAddChatEntity1737286893241';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`chat_messages\` (\`id\` int NOT NULL AUTO_INCREMENT, \`uuid\` varchar(36) NOT NULL DEFAULT (UUID()), \`role\` enum ('system', 'user', 'assistant') NOT NULL, \`model\` enum ('gpt-3.5-turbo', 'gpt-4', 'claude-3-sonnet') NULL DEFAULT 'gpt-3.5-turbo', \`content\` text NOT NULL, \`promptTokens\` int NULL, \`completionTokens\` int NULL, \`totalTokens\` int NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`chat_id\` int NULL, INDEX \`IDX_0333da391890109fc31b23996b\` (\`chat_id\`, \`createdAt\`), UNIQUE INDEX \`IDX_174a4dfb8aad42c935de4f5f2c\` (\`uuid\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`chats\` (\`id\` int NOT NULL AUTO_INCREMENT, \`uuid\` varchar(36) NOT NULL DEFAULT (UUID()), \`name\` varchar(100) NOT NULL, \`description\` varchar(500) NULL, \`status\` enum ('active', 'archived', 'deleted') NOT NULL DEFAULT 'active', \`context\` text NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`card_id\` int NULL, INDEX \`idx_chat_created\` (\`createdAt\`), INDEX \`idx_chat_status\` (\`status\`), INDEX \`idx_chat_card\` (\`card_id\`), UNIQUE INDEX \`IDX_4741e8cb46af785df554407dbc\` (\`uuid\`), UNIQUE INDEX \`REL_76a886ade665d6f8bff173b0c9\` (\`card_id\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`decks\` ADD \`uuid\` varchar(36) NULL`,
    );

    await queryRunner.query(
      `UPDATE \`decks\` SET \`uuid\` = UUID() WHERE \`uuid\` IS NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE \`decks\` MODIFY \`uuid\` varchar(36) NOT NULL`,
    );

    await queryRunner.query(
      `ALTER TABLE \`decks\` ADD UNIQUE INDEX \`IDX_cf8c1027ffc64786accee565bb\` (\`uuid\`)`,
    );

    await queryRunner.query(
      `ALTER TABLE \`cards\` ADD \`uuid\` varchar(36) NULL`,
    );
    await queryRunner.query(
      `UPDATE \`cards\` SET \`uuid\` = UUID() WHERE \`uuid\` IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`cards\` MODIFY \`uuid\` varchar(36) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`cards\` ADD UNIQUE INDEX \`IDX_cb3789f0e79e124e5753da0010\` (\`uuid\`)`,
    );
    await queryRunner.query(
      `ALTER TABLE \`chat_messages\` ADD CONSTRAINT \`FK_9f5c0b96255734666b7b4bc98c3\` FOREIGN KEY (\`chat_id\`) REFERENCES \`chats\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`chats\` ADD CONSTRAINT \`FK_76a886ade665d6f8bff173b0c93\` FOREIGN KEY (\`card_id\`) REFERENCES \`cards\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`chats\` DROP FOREIGN KEY \`FK_76a886ade665d6f8bff173b0c93\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`chat_messages\` DROP FOREIGN KEY \`FK_9f5c0b96255734666b7b4bc98c3\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`cards\` DROP INDEX \`IDX_cb3789f0e79e124e5753da0010\``,
    );
    await queryRunner.query(`ALTER TABLE \`cards\` DROP COLUMN \`uuid\``);
    await queryRunner.query(
      `ALTER TABLE \`decks\` DROP INDEX \`IDX_cf8c1027ffc64786accee565bb\``,
    );
    await queryRunner.query(`ALTER TABLE \`decks\` DROP COLUMN \`uuid\``);
    await queryRunner.query(
      `DROP INDEX \`REL_76a886ade665d6f8bff173b0c9\` ON \`chats\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_4741e8cb46af785df554407dbc\` ON \`chats\``,
    );
    await queryRunner.query(`DROP INDEX \`idx_chat_card\` ON \`chats\``);
    await queryRunner.query(`DROP INDEX \`idx_chat_status\` ON \`chats\``);
    await queryRunner.query(`DROP INDEX \`idx_chat_created\` ON \`chats\``);
    await queryRunner.query(`DROP TABLE \`chats\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_174a4dfb8aad42c935de4f5f2c\` ON \`chat_messages\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_0333da391890109fc31b23996b\` ON \`chat_messages\``,
    );
    await queryRunner.query(`DROP TABLE \`chat_messages\``);
  }
}
