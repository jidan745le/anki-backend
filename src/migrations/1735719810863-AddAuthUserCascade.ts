import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuthUserCascade1735719810863 implements MigrationInterface {
  name = 'AddAuthUserCascade1735719810863';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`auth_user\` DROP FOREIGN KEY \`FK_4a558982b7a6be5169b83572108\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`auth_user\` ADD CONSTRAINT \`FK_4a558982b7a6be5169b83572108\` FOREIGN KEY (\`userId\`) REFERENCES \`user\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`auth_user\` DROP FOREIGN KEY \`FK_4a558982b7a6be5169b83572108\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`auth_user\` ADD CONSTRAINT \`FK_4a558982b7a6be5169b83572108\` FOREIGN KEY (\`userId\`) REFERENCES \`user\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
}
