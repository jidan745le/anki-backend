import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAuthUser1735713582976 implements MigrationInterface {
    name = 'AddAuthUser1735713582976'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE \`auth_user\` (\`id\` int NOT NULL AUTO_INCREMENT, \`provider\` varchar(255) NOT NULL, \`providerId\` varchar(255) NOT NULL, \`email\` varchar(255) NOT NULL, \`firstName\` varchar(255) NULL, \`lastName\` varchar(255) NULL, \`picture\` varchar(255) NULL, \`createTime\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updateTime\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`userId\` int NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`);
        await queryRunner.query(`ALTER TABLE \`auth_user\` ADD CONSTRAINT \`FK_4a558982b7a6be5169b83572108\` FOREIGN KEY (\`userId\`) REFERENCES \`user\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`auth_user\` DROP FOREIGN KEY \`FK_4a558982b7a6be5169b83572108\``);
        await queryRunner.query(`DROP TABLE \`auth_user\``);
    }

}
