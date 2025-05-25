import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSessionIdToChatMessages1737287000000
  implements MigrationInterface
{
  name = 'AddSessionIdToChatMessages1737287000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`chat_messages\` ADD \`sessionId\` varchar(36) NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX \`IDX_chat_messages_sessionId\` ON \`chat_messages\` (\`sessionId\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX \`IDX_chat_messages_sessionId\` ON \`chat_messages\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`chat_messages\` DROP COLUMN \`sessionId\``,
    );
  }
}
