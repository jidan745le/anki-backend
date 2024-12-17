import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeckSettings1734018264297 implements MigrationInterface {
  name = 'AddDeckSettings1734018264297';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`deck_settings\` (\`id\` int NOT NULL AUTO_INCREMENT, \`hardInterval\` int NOT NULL DEFAULT '1440', \`easyInterval\` int NOT NULL DEFAULT '4320', \`deckId\` int NULL, UNIQUE INDEX \`REL_9a6015305ff1840691550739d3\` (\`deckId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`deck_settings\` ADD CONSTRAINT \`FK_9a6015305ff1840691550739d3e\` FOREIGN KEY (\`deckId\`) REFERENCES \`decks\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`deck_settings\` DROP FOREIGN KEY \`FK_9a6015305ff1840691550739d3e\``,
    );
    await queryRunner.query(
      `DROP INDEX \`REL_9a6015305ff1840691550739d3\` ON \`deck_settings\``,
    );
    await queryRunner.query(`DROP TABLE \`deck_settings\``);
  }
}
