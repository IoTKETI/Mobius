CREATE DATABASE mobiusdb;

CREATE USER 'mobius' IDENTIFIED BY 'mobius';
CREATE USER 'mobius'@'localhost' IDENTIFIED BY 'mobius';
CREATE USER 'mobius'@'%' IDENTIFIED BY 'mobius';

GRANT ALL PRIVILEGES ON mobiusdb.* TO mobius;