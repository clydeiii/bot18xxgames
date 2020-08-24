create table game (
    id serial primary key,
    game_id integer unique not null,
    guild_id varchar(18) not null,
    channel_id varchar(18) not null,
    is_active boolean not null default true
);

create table player (
    id serial primary key,
    game_id integer not null references game(id) on delete cascade,
    user_id varchar(18) not null
);
