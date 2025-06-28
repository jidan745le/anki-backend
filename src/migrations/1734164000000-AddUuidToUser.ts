import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddUuidToUser1734164000000 implements MigrationInterface {
  name = 'AddUuidToUser1734164000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 为user表添加uuid列
    await queryRunner.addColumn(
      'user',
      new TableColumn({
        name: 'uuid',
        type: 'varchar',
        length: '36',
        isNullable: false,
        generationStrategy: 'uuid',
        comment: '用户UUID',
      }),
    );

    // 为现有用户生成UUID
    await queryRunner.query(`UPDATE "user" SET "uuid" = gen_random_uuid()`);

    console.log('Successfully added uuid column to user table');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 回滚时删除uuid列
    await queryRunner.dropColumn('user', 'uuid');
    console.log('Successfully removed uuid column from user table');
  }
}
