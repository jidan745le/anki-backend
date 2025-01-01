import { MigrationInterface, QueryRunner } from "typeorm";

export class AddDeckCascade1735720220955 implements MigrationInterface {
    name = 'AddDeckCascade1735720220955'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`decks\` DROP FOREIGN KEY \`FK_d60e048034edfd232e0b8cedaeb\``);
        await queryRunner.query(`ALTER TABLE \`decks\` ADD CONSTRAINT \`FK_d60e048034edfd232e0b8cedaeb\` FOREIGN KEY (\`userId\`) REFERENCES \`user\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`decks\` DROP FOREIGN KEY \`FK_d60e048034edfd232e0b8cedaeb\``);
        await queryRunner.query(`ALTER TABLE \`decks\` ADD CONSTRAINT \`FK_d60e048034edfd232e0b8cedaeb\` FOREIGN KEY (\`userId\`) REFERENCES \`user\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

}
