import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddTagsToUserCards1734163200000 implements MigrationInterface {
  name = 'AddTagsToUserCards1734163200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 为user_cards表添加tags列
    await queryRunner.addColumn(
      'user_cards',
      new TableColumn({
        name: 'tags',
        type: 'varchar',
        length: '500',
        isNullable: true,
        comment: '用户自定义标签',
      }),
    );

    console.log('Successfully added tags column to user_cards table');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 回滚时删除tags列
    await queryRunner.dropColumn('user_cards', 'tags');
    console.log('Successfully removed tags column from user_cards table');
  }
}
