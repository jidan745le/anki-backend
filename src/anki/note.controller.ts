import {
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Patch,
    Post,
    Query,
    Request,
    UseGuards,
} from '@nestjs/common';
import { LoginGuard } from '../login.guard';
import { BatchWriteNotesDto } from './dto/batch-write-notes.dto';
import { CreateNoteDto } from './dto/create-note.dto';
import { GetNotesDto } from './dto/get-notes.dto';
import { UpdateNoteDto } from './dto/update-note.dto';
import { NoteService } from './note.service';

@Controller('notes')
@UseGuards(LoginGuard)
export class NoteController {
  constructor(private readonly noteService: NoteService) {}

  @Post()
  create(@Body() createNoteDto: CreateNoteDto, @Request() req) {
    return this.noteService.create(createNoteDto, req.user.id);
  }

  @Post('batch')
  batchWrite(@Body() batchWriteNotesDto: BatchWriteNotesDto, @Request() req) {
    return this.noteService.batchWrite(batchWriteNotesDto, req.user.id);
  }

  @Get()
  findAll(@Request() req, @Query() getNotesDto: GetNotesDto) {
    return this.noteService.findAll(req.user.id, getNotesDto);
  }

  @Get('user-card/:userCardUuid')
  getNotesForUserCard(
    @Param('userCardUuid') userCardUuid: string,
    @Request() req,
  ) {
    return this.noteService.getNotesForUserCard(userCardUuid, req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Request() req) {
    return this.noteService.findOne(+id, req.user.id);
  }

  @Get('uuid/:uuid')
  findByUuid(@Param('uuid') uuid: string, @Request() req) {
    return this.noteService.findByUuid(uuid, req.user.id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateNoteDto: UpdateNoteDto,
    @Request() req,
  ) {
    return this.noteService.update(+id, updateNoteDto, req.user.id);
  }

  @Patch(':id/toggle-pin')
  togglePin(@Param('id') id: string, @Request() req) {
    return this.noteService.togglePin(+id, req.user.id);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req) {
    return this.noteService.remove(+id, req.user.id);
  }
}
